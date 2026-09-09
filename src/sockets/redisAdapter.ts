import type { Server as SocketIOServer } from 'socket.io';
import type Redis from 'ioredis';
import { createAdapter } from '@socket.io/redis-adapter';
import { getRedisClient } from '../redis';
import { logger } from '../observability/logger';

/**
 * Cross-instance WebSocket fan-out.
 *
 * `io.to('concert:X').emit(...)` only reaches sockets connected to THIS process. Behind a load
 * balancer that's a correctness gap in what the user sees: a buyer on pod B never learns about the
 * seat pod A just sold, and a waiter on pod B never receives the `queue:admitted` push that pod A
 * promoted them with. The Redis adapter closes it — every room emit is published to Redis pub/sub and
 * each instance delivers it to its own local sockets in that room.
 *
 * **Two dedicated clients, deliberately.** A Redis connection in subscribe mode can't run ordinary
 * commands, so reusing the shared client (rate limiter, queue, auth stores) would break every other
 * caller. `duplicate()` gives this adapter connections it owns exclusively.
 *
 * **…with the fail-fast options deliberately reversed.** The shared client sets
 * `enableOfflineQueue: false` + `maxRetriesPerRequest: 1` so a request-path command rejects
 * immediately instead of stalling the request. Those settings are actively wrong for a long-lived
 * pub/sub connection: the adapter issues `psubscribe` in its constructor, *before* the socket has
 * finished connecting, so with the offline queue disabled that first command is rejected and the
 * process dies at startup (found by src/scripts/proveCrossInstance.ts). A subscriber has no request
 * to stall — it should queue, reconnect and resubscribe — so these two connections override both.
 *
 * **Degrades open by construction:** socket.io delivers to local sockets AND publishes. If Redis is
 * unreachable only the cross-instance hop is lost — same-instance clients still get their events —
 * so there's nothing to fail closed here (a live push is a convenience; the seat map is refetchable).
 */
let pub: Redis | null = null;
let sub: Redis | null = null;

// Read per call, like the other Redis-backed modules: tests and REDIS_URL-less dev stay single-instance.
const useRedis = () => process.env.NODE_ENV !== 'test' && !!process.env.REDIS_URL;

/** Attach the adapter if Redis is configured. Returns whether cross-instance fan-out is active. */
export function attachRedisAdapter(io: SocketIOServer): boolean {
    if (pub) return true; // already attached
    if (!useRedis()) {
        logger.info('socket.io: single-instance mode (no REDIS_URL) — room emits stay in this process');
        return false;
    }
    const pubSubOptions = { enableOfflineQueue: true, maxRetriesPerRequest: null };
    pub = getRedisClient().duplicate(pubSubOptions);
    sub = pub.duplicate(pubSubOptions);
    // A pub/sub blip must never take the process down — log and let socket.io carry on locally.
    pub.on('error', (err) => logger.warn({ err }, 'socket.io adapter: publisher error'));
    sub.on('error', (err) => logger.warn({ err }, 'socket.io adapter: subscriber error'));
    io.adapter(createAdapter(pub, sub));
    logger.info('socket.io: Redis adapter attached — room emits fan out across instances');
    return true;
}

/** Close the adapter's own connections. Called from the shutdown drain. */
export async function closeSocketAdapter(): Promise<void> {
    const clients = [pub, sub].filter((c): c is Redis => c !== null);
    pub = null;
    sub = null;
    await Promise.allSettled(clients.map((c) => c.quit()));
}
