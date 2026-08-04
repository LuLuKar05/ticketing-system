import Redis from 'ioredis';
import { logger } from './observability/logger';

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

export async function closeRedis(): Promise<void> {
    if (client) {
        await client.quit();
        client = null;
    }
}
