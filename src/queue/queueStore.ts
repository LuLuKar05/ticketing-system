import { getRedisClient } from '../redis';
import { logger } from '../observability/logger';

/**
 * Per-concert waiting-room queue state.
 *
 * Model: a FIFO **wait** sorted set (score = join sequence) and an **active** sorted set (member =
 * userId, score = the pass's expiry timestamp). "Admitted" = you're in `active` with an unexpired
 * score. Admission is **slot-by-slot**: promotion drops expired actives, then admits the head of the
 * line up to the cap N — atomically (a Lua script on Redis; synchronous JS in the in-memory
 * fallback). Promotion returns the newly-admitted userIds so callers can push them a "you're in"
 * event.
 *
 * **Fail-open:** the queue is a load/UX layer, not a correctness guard (the seat unique index + the
 * confirm compare-and-set are). So if Redis is unreachable, every operation degrades to "admit" and
 * logs a warning rather than blocking sales.
 */
const useRedis = process.env.NODE_ENV !== 'test' && !!process.env.REDIS_URL;

const activeKey = (cid: string) => `queue:active:${cid}`;
const waitKey = (cid: string) => `queue:wait:${cid}`;
const seqKey = (cid: string) => `queue:seq:${cid}`;

// in-memory fallback
const memActive = new Map<string, Map<string, number>>(); // cid -> (userId -> passExpiryMs)
const memWait = new Map<string, Map<string, number>>(); // cid -> (userId -> joinSeq)
const memSeq = new Map<string, number>();

export interface QueueState {
    admitted: boolean;
    position: number;
    promoted: string[]; // userIds newly admitted by this call's promotion
}

// ---- Redis backend ----

// Drop expired actives, then admit head-of-line until the cap is full. Returns promoted userIds.
const PROMOTE_LUA = `
local now = tonumber(ARGV[1])
local cap = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
local promoted = {}
while redis.call('ZCARD', KEYS[1]) < cap do
  local head = redis.call('ZPOPMIN', KEYS[2])
  if #head == 0 then break end
  redis.call('ZADD', KEYS[1], now + ttl, head[1])
  table.insert(promoted, head[1])
end
return promoted
`;

async function promoteRedis(cid: string, cap: number, ttlMs: number): Promise<string[]> {
    const res = await getRedisClient().eval(
        PROMOTE_LUA,
        2,
        activeKey(cid),
        waitKey(cid),
        String(Date.now()),
        String(cap),
        String(ttlMs),
    );
    return (res as string[] | null) ?? [];
}

async function isAdmittedRedis(cid: string, userId: string): Promise<boolean> {
    const score = await getRedisClient().zscore(activeKey(cid), userId);
    return score !== null && Number(score) > Date.now();
}

async function addToWaitRedis(cid: string, userId: string): Promise<void> {
    const client = getRedisClient();
    if ((await client.zscore(waitKey(cid), userId)) === null) {
        const seq = await client.incr(seqKey(cid));
        await client.zadd(waitKey(cid), 'NX', String(seq), userId);
    }
}

async function positionRedis(cid: string, userId: string): Promise<number> {
    const rank = await getRedisClient().zrank(waitKey(cid), userId);
    return rank === null ? 0 : rank + 1;
}

// ---- in-memory backend (never throws) ----

function promoteMemory(cid: string, cap: number, ttlMs: number): string[] {
    const now = Date.now();
    const active = memActive.get(cid) ?? new Map<string, number>();
    const wait = memWait.get(cid) ?? new Map<string, number>();
    for (const [userId, exp] of active) if (exp <= now) active.delete(userId);
    const promoted: string[] = [];
    for (const [userId] of [...wait.entries()].sort((a, b) => a[1] - b[1])) {
        if (active.size >= cap) break;
        active.set(userId, now + ttlMs);
        wait.delete(userId);
        promoted.push(userId);
    }
    memActive.set(cid, active);
    memWait.set(cid, wait);
    return promoted;
}

function isAdmittedMemory(cid: string, userId: string): boolean {
    const exp = memActive.get(cid)?.get(userId);
    return exp !== undefined && exp > Date.now();
}

function addToWaitMemory(cid: string, userId: string): void {
    const wait = memWait.get(cid) ?? new Map<string, number>();
    if (!wait.has(userId)) {
        const seq = (memSeq.get(cid) ?? 0) + 1;
        memSeq.set(cid, seq);
        wait.set(userId, seq);
        memWait.set(cid, wait);
    }
}

function positionMemory(cid: string, userId: string): number {
    const wait = memWait.get(cid);
    if (!wait?.has(userId)) return 0;
    return [...wait.entries()].sort((a, b) => a[1] - b[1]).findIndex(([u]) => u === userId) + 1;
}

// ---- public API (Redis path fails open) ----

const ADMIT_OPEN: QueueState = { admitted: true, position: 0, promoted: [] };

export async function isAdmitted(cid: string, userId: string): Promise<boolean> {
    if (!useRedis) return isAdmittedMemory(cid, userId);
    try {
        return await isAdmittedRedis(cid, userId);
    } catch (err) {
        logger.warn({ err }, 'queue: Redis unreachable — failing open (admit)');
        return true;
    }
}

async function run(cid: string, userId: string, cap: number, ttlMs: number, enqueue: boolean): Promise<QueueState> {
    if (!useRedis) {
        const promoted = promoteMemory(cid, cap, ttlMs);
        if (isAdmittedMemory(cid, userId)) return { admitted: true, position: 0, promoted };
        if (enqueue) addToWaitMemory(cid, userId);
        const promoted2 = enqueue ? promoteMemory(cid, cap, ttlMs) : [];
        const admitted = isAdmittedMemory(cid, userId);
        return {
            admitted,
            position: admitted ? 0 : positionMemory(cid, userId),
            promoted: [...promoted, ...promoted2],
        };
    }
    try {
        const promoted = await promoteRedis(cid, cap, ttlMs);
        if (await isAdmittedRedis(cid, userId)) return { admitted: true, position: 0, promoted };
        if (enqueue) await addToWaitRedis(cid, userId);
        const promoted2 = enqueue ? await promoteRedis(cid, cap, ttlMs) : [];
        const admitted = await isAdmittedRedis(cid, userId);
        return {
            admitted,
            position: admitted ? 0 : await positionRedis(cid, userId),
            promoted: [...promoted, ...promoted2],
        };
    } catch (err) {
        logger.warn({ err }, 'queue: Redis unreachable — failing open (admit)');
        return ADMIT_OPEN;
    }
}

/** Join the line (idempotent). Admitted immediately if there's room, else returns your position. */
export function join(cid: string, userId: string, cap: number, ttlMs: number): Promise<QueueState> {
    return run(cid, userId, cap, ttlMs, true);
}

/** Read-only status (also lazily promotes, so a poll picks up freed slots). */
export function status(cid: string, userId: string, cap: number, ttlMs: number): Promise<QueueState> {
    return run(cid, userId, cap, ttlMs, false);
}

/** Give up the slot (purchase complete / user left). The next poller's promote fills the gap. */
export async function release(cid: string, userId: string): Promise<void> {
    if (!useRedis) {
        memActive.get(cid)?.delete(userId);
        return;
    }
    try {
        await getRedisClient().zrem(activeKey(cid), userId);
    } catch (err) {
        logger.warn({ err }, 'queue: Redis unreachable — release skipped');
    }
}
