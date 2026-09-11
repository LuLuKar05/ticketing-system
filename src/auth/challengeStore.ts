import { getRedisClient, redisCall } from '../redis';

/**
 * Short-lived store for in-flight WebAuthn challenges. A challenge is issued in the `/options` step
 * and must be presented back (single-use) in the `/verify` step. Redis when available (shared across
 * instances, real TTL); an in-memory map otherwise (tests / no `REDIS_URL`), mirroring the rate
 * limiter's fallback.
 *
 * **Fail-closed** (via `redisCall`): if Redis is down we cannot issue or single-use-consume a
 * challenge, and treating a missing challenge as "fine" would defeat the ceremony's replay
 * protection. So the request gets a clean 503 and the client retries — never a silent pass.
 */
// Read per call (not frozen at import) so the backend stays configurable — and so tests can exercise
// the Redis branch. Same reasoning as QueueService's config getters.
const useRedis = () => process.env.NODE_ENV !== 'test' && !!process.env.REDIS_URL;
const DEFAULT_TTL_SEC = 300; // 5 minutes to complete the ceremony

const memory = new Map<string, { value: string; expiresAt: number }>();

export async function setChallenge(key: string, value: string, ttlSec: number = DEFAULT_TTL_SEC): Promise<void> {
    if (useRedis()) {
        await redisCall('challenge.set', () => getRedisClient().set(key, value, 'EX', ttlSec));
        return;
    }
    memory.set(key, { value, expiresAt: Date.now() + ttlSec * 1000 });
}

/** Fetch AND delete the challenge (single-use). Returns null if missing or expired. */
export async function takeChallenge(key: string): Promise<string | null> {
    if (useRedis()) {
        return redisCall('challenge.take', async () => {
            const client = getRedisClient();
            const value = await client.get(key);
            if (value !== null) await client.del(key);
            return value;
        });
    }
    const entry = memory.get(key);
    if (!entry) return null;
    memory.delete(key);
    return entry.expiresAt < Date.now() ? null : entry.value;
}
