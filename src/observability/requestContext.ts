import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request context carried implicitly through the async call chain via AsyncLocalStorage,
 * so cross-cutting data (the correlation id) is available to any layer — the logger especially —
 * WITHOUT threading it through every service/repository signature.
 */
export interface RequestContext {
    correlationId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Run `fn` (and everything it awaits) with `context` bound to the async-local store. */
export function runWithContext(context: RequestContext, fn: () => void): void {
    storage.run(context, fn);
}

/** The current request's correlation id, or undefined outside a request (e.g. the sweeper). */
export function getCorrelationId(): string | undefined {
    return storage.getStore()?.correlationId;
}
