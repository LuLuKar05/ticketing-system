import type { Server as SocketIOServer } from 'socket.io';
import { attachRedisAdapter, closeSocketAdapter } from '../../src/sockets/redisAdapter';

/**
 * Cross-instance fan-out itself can't be proven here — it needs two processes and a real Redis
 * (see src/scripts/proveCrossInstance.ts). What this pins is the part that must never regress
 * silently: with no Redis configured the adapter stays OFF and socket.io keeps its default
 * in-memory adapter, so tests and single-instance dev behave exactly as before.
 */
describe('socket.io Redis adapter — wiring', () => {
    const fakeIo = () => ({ adapter: jest.fn() }) as unknown as SocketIOServer & { adapter: jest.Mock };

    afterEach(async () => {
        delete process.env.REDIS_URL;
        await closeSocketAdapter();
    });

    it('is skipped when REDIS_URL is unset — the default adapter is left alone', () => {
        const io = fakeIo();
        expect(attachRedisAdapter(io)).toBe(false);
        expect(io.adapter).not.toHaveBeenCalled();
    });

    it('is skipped under NODE_ENV=test even if REDIS_URL is set — the suite never opens a connection', () => {
        process.env.REDIS_URL = 'redis://127.0.0.1:6379';
        const io = fakeIo();
        expect(attachRedisAdapter(io)).toBe(false);
        expect(io.adapter).not.toHaveBeenCalled();
    });

    it('closing is a safe no-op when nothing was attached', async () => {
        await expect(closeSocketAdapter()).resolves.toBeUndefined();
    });
});
