import { getRedisClient } from './redis';
import { logger } from './observability/logger';

/**
 * A cluster-wide "only one instance does this" lease, built on `SET key NX PX ttl`.
 *
 * The problem it solves: every instance runs its own `setInterval` background jobs. With N instances
 * the sweeper fires N times a minute — the bulk UPDATE is harmless (the losers match zero rows), but
 * each instance independently reads the seats it freed and publishes `seat:released`, so clients get
 * N copies of every release and the DB takes N× the load for one minute's work.
 *
 * **It is a lease, not a mutex — and it is deliberately never released.** Holding it for the full
 * interval means "this minute's tick is taken", so exactly one sweep happens per interval across the
 * cluster. A mutex released at the end of the work would just let the next instance immediately run
 * the same tick again, which is the behaviour we're trying to remove.
 *
 * **Fails open.** If Redis is unreachable the caller proceeds: a duplicated sweep is cosmetic
 * (idempotent UPDATE, at worst a repeated release event), whereas *skipping* sweeps would leave
 * abandoned holds locking up inventory until Redis came back. Same reasoning as the queue: this is
 * an efficiency guard, not a correctness one.
 */
const useRedis = () => process.env.NODE_ENV !== 'test' && !!process.env.REDIS_URL;

export async function tryAcquireLease(key: string, ttlMs: number): Promise<boolean> {
    // Single instance (dev/test, or no Redis configured) — there is nobody to coordinate with.
    if (!useRedis()) return true;
    try {
        const res = await getRedisClient().set(key, String(process.pid), 'PX', ttlMs, 'NX');
        return res === 'OK';
    } catch (err) {
        logger.warn({ err, key }, 'lease: Redis unreachable — proceeding without coordination');
        return true;
    }
}
