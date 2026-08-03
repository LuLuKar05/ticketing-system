import pino from 'pino';
import { getCorrelationId } from './requestContext';

/**
 * Injected into every log line by Pino's `mixin` hook. Reads the correlation id from the
 * async-local store (set by the correlationId middleware) so logs are traceable WITHOUT any
 * service passing the id around. Empty outside a request (e.g. the sweeper) — no key added.
 */
export function correlationMixin(): Record<string, string> {
    const id = getCorrelationId();
    return id ? { correlation_id: id } : {};
}

const env = process.env.NODE_ENV;
const isTest = env === 'test';
const isProd = env === 'production';
// Pretty output is opt-in (LOG_PRETTY=true) for local readability; the default everywhere is
// structured JSON — which is what the ops/log deliverable needs. Silent under tests.
const usePretty = process.env.LOG_PRETTY === 'true' && !isTest && !isProd;

export const logger = pino({
    level: process.env.LOG_LEVEL ?? (isTest ? 'silent' : 'info'),
    mixin: correlationMixin,
    ...(usePretty
        ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } } }
        : {}),
});
