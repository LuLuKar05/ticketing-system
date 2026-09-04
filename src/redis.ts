import Redis from 'ioredis';
import { logger } from './observability/logger';
import { ServiceUnavailableError } from './error';

/**
 * Lazily-created shared ioredis client (used by the rate limiter). Created on first use so tests /
 * environments without `REDIS_URL` never open a connection. Configured to fail FAST rather than
 * queue commands forever, so a Redis outage surfaces quickly and the caller can fail open.
 */
let client: Redis | null = null;

export function getRedisClient(): Redis {
    if (!client) {
        const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
        client = new Redis(url, {
            maxRetriesPerRequest: 1, // don't retry forever — surface failures so we can fail open
            enableOfflineQueue: false, // reject commands immediately when disconnected
            lazyConnect: false,
        });
        client.on('error', (err) => logger.warn({ err }, 'redis client error'));
    }
    return client;
}

/**
 * Run a Redis command **fail-closed**: on an outage, log with the operation name and rethrow as a
 * `ServiceUnavailableError` so the central error handler returns the uniform `{ error, message, ref }`
 * envelope with a 503 instead of an opaque 500.
 *
 * Use this for state that must not be skipped (auth challenges, refresh families, recovery codes).
 * Callers that can safely degrade — the waiting-room queue, the rate limiter — deliberately do NOT
 * use it; they catch and fail *open* instead.
 */
export async function redisCall<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    try {
        return await fn();
    } catch (err) {
        logger.error({ err, operation }, 'redis unavailable — failing closed');
        throw new ServiceUnavailableError('A required service is temporarily unavailable — please retry.');
    }
}

export async function closeRedis(): Promise<void> {
    if (client) {
        await client.quit();
        client = null;
    }
}
