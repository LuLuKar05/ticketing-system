import { Request, Response, NextFunction, RequestHandler } from 'express';
import { RateLimiterMemory, RateLimiterRedis, RateLimiterRes, RateLimiterAbstract } from 'rate-limiter-flexible';
import { getRedisClient } from '../redis';
import { logger } from '../observability/logger';
import { RateLimitedError } from '../error';

const POINTS = Number(process.env.RATELIMIT_POINTS ?? 5); // requests…
const DURATION = Number(process.env.RATELIMIT_DURATION ?? 60); // …per this many seconds

export interface RateLimitOptions {
    keyPrefix: string; // isolates each endpoint's counter (e.g. 'reserve', 'confirm', 'seat-import')
    points?: number;
    duration?: number;
}

/**
 * Reusable per-IP rate limiter for write endpoints (OWASP API4/API6 — flood + drop abuse).
 *
 * Algorithm: a ROLLING-COUNTER WINDOW — rate-limiter-flexible increments a counter keyed by IP and
 * expires it `duration` seconds after the FIRST request in the window (anchored to first request,
 * not the wall clock — so there's no shared :00 boundary for everyone to burst against). This is a
 * fixed-window-from-first-request, not a true sliding-window log.
 * - Redis-backed (shared across app instances) in real environments; in-memory under tests or when
 *   no REDIS_URL is set, so CI needs no Redis. rate-limiter-flexible does the INCR+TTL atomically
 *   via a Redis Lua script internally.
 * - Over the limit → 429 RATE_LIMITED (+ Retry-After). Every response still carries the correlation id.
 * - FAIL-OPEN: if the store itself errors (Redis down), log and allow the request through, so a
 *   Redis blip can't take the endpoint offline. Trade-off: the limit isn't enforced during an outage.
 *
 * Built fresh per createApp() call → each test gets isolated counters.
 */
export function buildRateLimiter({
    keyPrefix,
    points = POINTS,
    duration = DURATION,
}: RateLimitOptions): RequestHandler {
    const useRedis = process.env.NODE_ENV !== 'test' && !!process.env.REDIS_URL;
    const base = { points, duration, keyPrefix: `rl:${keyPrefix}` };
    const limiter: RateLimiterAbstract = useRedis
        ? new RateLimiterRedis({ ...base, storeClient: getRedisClient() })
        : new RateLimiterMemory(base);

    return (req: Request, res: Response, next: NextFunction): void => {
        const key = req.ip ?? 'unknown';
        limiter
            .consume(key)
            .then(() => next())
            .catch((err: unknown) => {
                if (err instanceof RateLimiterRes) {
                    // Over the limit — a normal 429.
                    res.setHeader('Retry-After', Math.ceil(err.msBeforeNext / 1000));
                    next(new RateLimitedError());
                } else {
                    // Store failure (e.g. Redis down) — fail open.
                    logger.warn({ err }, 'rate limiter store error; failing open');
                    next();
                }
            });
    };
}
