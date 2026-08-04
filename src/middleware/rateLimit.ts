import { Request, Response, NextFunction, RequestHandler } from 'express';
import { RateLimiterMemory, RateLimiterRedis, RateLimiterRes, RateLimiterAbstract } from 'rate-limiter-flexible';
import { getRedisClient } from '../redis';
import { logger } from '../observability/logger';
import { RateLimitedError } from '../error';

const POINTS = Number(process.env.RATELIMIT_POINTS ?? 5); // requests…
const DURATION = Number(process.env.RATELIMIT_DURATION ?? 60); // …per this many seconds (sliding)

/**
 * Sliding-window rate limiter for the hold endpoint (OWASP API4/API6 — flood + drop abuse).
 * - Redis-backed (shared across app instances) in real environments; in-memory under tests or when
 *   no REDIS_URL is set, so CI needs no Redis. rate-limiter-flexible uses atomic Redis Lua internally.
 * - Keyed by client IP. Over the limit → 429 RATE_LIMITED (+ Retry-After).
 * - FAIL-OPEN: if the store itself errors (Redis down), log and allow the request through, so a
 *   Redis blip can't take the endpoint offline. Trade-off: the limit isn't enforced during an outage.
 *
 * Built fresh per createApp() call → each test gets isolated counters.
 */
export function buildReserveRateLimiter(): RequestHandler {
    const useRedis = process.env.NODE_ENV !== 'test' && !!process.env.REDIS_URL;
    const base = { points: POINTS, duration: DURATION, keyPrefix: 'rl:reserve' };
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
