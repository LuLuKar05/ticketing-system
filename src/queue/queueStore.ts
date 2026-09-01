import { getRedisClient } from '../redis';

/**
 * Per-concert waiting-room queue state.
 *
 * Model: a FIFO **wait** sorted set (score = join sequence) and an **active** sorted set (member =
 * userId, score = the pass's expiry timestamp). "Admitted" = you're in `active` with an unexpired
 * score. Admission is **slot-by-slot**: promotion drops expired actives, then admits the head of the
 * line up to the cap N. On Redis that promotion is a **Lua script** so it runs atomically and N is
 * never exceeded even under a stampede; the in-memory fallback (tests / no Redis) does the same work
 * synchronously, which is equally atomic within Node's single event-loop tick.
 */
const useRedis = process.env.NODE_ENV !== 'test' && !!process.env.REDIS_URL;

const activeKey = (cid: string) => `queue:active:${cid}`;
const waitKey = (cid: string) => `queue:wait:${cid}`;
const seqKey = (cid: string) => `queue:seq:${cid}`;

// in-memory fallback
const memActive = new Map<string, Map<string, number>>(); // cid -> (userId -> passExpiryMs)
const memWait = new Map<string, Map<string, number>>(); // cid -> (userId -> joinSeq)
const memSeq = new Map<string, number>();

// Drop expired actives, then admit the lowest-sequence waiters until the cap is full. Atomic.
const PROMOTE_LUA = `
local now = tonumber(ARGV[1])
local cap = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
while redis.call('ZCARD', KEYS[1]) < cap do
  local head = redis.call('ZPOPMIN', KEYS[2])
  if #head == 0 then break end
  redis.call('ZADD', KEYS[1], now + ttl, head[1])
end
return 1
`;

async function promote(cid: string, cap: number, ttlMs: number): Promise<void> {
    const now = Date.now();
    if (useRedis) {
        await getRedisClient().eval(
            PROMOTE_LUA,
            2,
            activeKey(cid),
            waitKey(cid),
            String(now),
            String(cap),
            String(ttlMs),
        );
        return;
    }
    const active = memActive.get(cid) ?? new Map<string, number>();
    const wait = memWait.get(cid) ?? new Map<string, number>();
    for (const [userId, exp] of active) if (exp <= now) active.delete(userId);
    for (const [userId] of [...wait.entries()].sort((a, b) => a[1] - b[1])) {
        if (active.size >= cap) break;
        active.set(userId, now + ttlMs);
        wait.delete(userId);
    }
    memActive.set(cid, active);
    memWait.set(cid, wait);
}

export async function isAdmitted(cid: string, userId: string): Promise<boolean> {
    const now = Date.now();
    if (useRedis) {
        const score = await getRedisClient().zscore(activeKey(cid), userId);
        return score !== null && Number(score) > now;
    }
    const exp = memActive.get(cid)?.get(userId);
    return exp !== undefined && exp > now;
}

async function addToWait(cid: string, userId: string): Promise<void> {
    if (useRedis) {
        const client = getRedisClient();
        if ((await client.zscore(waitKey(cid), userId)) === null) {
            const seq = await client.incr(seqKey(cid));
            await client.zadd(waitKey(cid), 'NX', String(seq), userId);
        }
        return;
    }
    const wait = memWait.get(cid) ?? new Map<string, number>();
    if (!wait.has(userId)) {
        const seq = (memSeq.get(cid) ?? 0) + 1;
        memSeq.set(cid, seq);
        wait.set(userId, seq);
        memWait.set(cid, wait);
    }
}

/** 1-based position in the line, or 0 if not waiting. */
async function position(cid: string, userId: string): Promise<number> {
    if (useRedis) {
        const rank = await getRedisClient().zrank(waitKey(cid), userId);
        return rank === null ? 0 : rank + 1;
    }
    const wait = memWait.get(cid);
    if (!wait?.has(userId)) return 0;
    const rank = [...wait.entries()].sort((a, b) => a[1] - b[1]).findIndex(([u]) => u === userId);
    return rank + 1;
}

export interface QueueState {
    admitted: boolean;
    position: number;
}

/** Join the line (idempotent). Returns admitted immediately if there's room, else your position. */
export async function join(cid: string, userId: string, cap: number, ttlMs: number): Promise<QueueState> {
    await promote(cid, cap, ttlMs);
    if (await isAdmitted(cid, userId)) return { admitted: true, position: 0 };
    await addToWait(cid, userId);
    await promote(cid, cap, ttlMs);
    if (await isAdmitted(cid, userId)) return { admitted: true, position: 0 };
    return { admitted: false, position: await position(cid, userId) };
}

/** Read-only status check (also lazily promotes, so a poll picks up freed slots). */
export async function status(cid: string, userId: string, cap: number, ttlMs: number): Promise<QueueState> {
    await promote(cid, cap, ttlMs);
    if (await isAdmitted(cid, userId)) return { admitted: true, position: 0 };
    return { admitted: false, position: await position(cid, userId) };
}

/** Give up the slot (purchase complete / user left). The next poller's promote fills the gap. */
export async function release(cid: string, userId: string): Promise<void> {
    if (useRedis) {
        await getRedisClient().zrem(activeKey(cid), userId);
        return;
    }
    memActive.get(cid)?.delete(userId);
}
