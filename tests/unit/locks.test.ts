import { tryAcquireLease } from '../../src/locks';
import { getRedisClient } from '../../src/redis';

jest.mock('../../src/redis', () => ({ getRedisClient: jest.fn() }));

const mockSet = (impl: () => Promise<unknown>) => {
    (getRedisClient as jest.Mock).mockReturnValue({ set: jest.fn(impl) });
};

/**
 * The lease is what stops N instances from each running the same background tick. It is an
 * efficiency guard, not a correctness one — so every failure mode has to let the caller proceed.
 */
describe('tryAcquireLease', () => {
    afterEach(() => {
        delete process.env.REDIS_URL;
        process.env.NODE_ENV = 'test';
        jest.clearAllMocks();
    });

    it('grants the lease with no Redis configured — a single instance has nobody to coordinate with', async () => {
        await expect(tryAcquireLease('lease:x', 1000)).resolves.toBe(true);
        expect(getRedisClient).not.toHaveBeenCalled();
    });

    describe('with Redis', () => {
        beforeEach(() => {
            process.env.NODE_ENV = 'production';
            process.env.REDIS_URL = 'redis://127.0.0.1:6379';
        });

        it('grants it to the instance whose SET NX wins', async () => {
            mockSet(() => Promise.resolve('OK'));
            await expect(tryAcquireLease('lease:sweeper', 60_000)).resolves.toBe(true);
        });

        it('denies it to everyone else while the key is held (SET NX returns null)', async () => {
            mockSet(() => Promise.resolve(null));
            await expect(tryAcquireLease('lease:sweeper', 60_000)).resolves.toBe(false);
        });

        it('sends NX + PX so the lease is exclusive AND self-expiring (a dead holder cannot wedge it)', async () => {
            const set = jest.fn().mockResolvedValue('OK');
            (getRedisClient as jest.Mock).mockReturnValue({ set });
            await tryAcquireLease('lease:sweeper', 60_000);
            expect(set).toHaveBeenCalledWith('lease:sweeper', expect.any(String), 'PX', 60_000, 'NX');
        });

        it('fails OPEN on a Redis outage — a duplicated sweep beats no sweep at all', async () => {
            mockSet(() => Promise.reject(new Error('ECONNREFUSED')));
            await expect(tryAcquireLease('lease:sweeper', 60_000)).resolves.toBe(true);
        });
    });
});
