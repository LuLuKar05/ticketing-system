import { redisCall } from '../../src/redis';
import { ServiceUnavailableError } from '../../src/error';
import * as challengeStore from '../../src/auth/challengeStore';
import * as recoveryStore from '../../src/auth/recoveryStore';
import { issueRefreshToken, rotateRefreshToken, revokeRefreshToken } from '../../src/auth/refreshToken';

/**
 * The queue and the rate limiter fail OPEN on a Redis outage (they're load/UX layers). The auth
 * stores must not: skipping a single-use challenge check, accepting an unverifiable refresh token, or
 * losing a recovery code's attempt budget would each be a real security hole. They fail CLOSED with a
 * 503 instead — this file pins both halves of that contract.
 */
jest.mock('../../src/redis', () => {
    const actual = jest.requireActual<typeof import('../../src/redis')>('../../src/redis');
    return {
        ...actual,
        getRedisClient: () => {
            throw new Error('connect ECONNREFUSED 127.0.0.1:6379');
        },
    };
});

describe('redisCall — the fail-closed wrapper', () => {
    it('passes the value through when Redis is healthy', async () => {
        await expect(redisCall('ok', () => Promise.resolve('value'))).resolves.toBe('value');
    });

    it('maps a rejected command to a 503 ServiceUnavailableError (not a raw 500)', async () => {
        const err = await redisCall('boom', () => Promise.reject(new Error('READONLY'))).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(ServiceUnavailableError);
        expect((err as ServiceUnavailableError).statusCode).toBe(503);
        expect((err as ServiceUnavailableError).code).toBe('SERVICE_UNAVAILABLE');
        expect((err as ServiceUnavailableError).retryAfterSeconds).toBeGreaterThan(0);
    });

    it('also catches a SYNCHRONOUS throw — a dead client throws before returning a promise', async () => {
        await expect(
            redisCall('sync', () => {
                throw new Error('client destroyed');
            }),
        ).rejects.toBeInstanceOf(ServiceUnavailableError);
    });

    it('never leaks the underlying Redis error text to the client', async () => {
        const err = (await redisCall('leak', () => Promise.reject(new Error('NOAUTH secret-looking-detail'))).catch(
            (e: unknown) => e,
        )) as Error;
        expect(err.message).not.toContain('secret-looking-detail');
    });
});

describe('auth stores fail CLOSED when Redis is unreachable', () => {
    // The stores read the backend flag per call, so flipping env here selects the Redis branch;
    // getRedisClient is mocked above to throw the way a dead connection does.
    beforeEach(() => {
        process.env.NODE_ENV = 'production';
        process.env.REDIS_URL = 'redis://127.0.0.1:6379';
    });
    afterEach(() => {
        process.env.NODE_ENV = 'test';
        delete process.env.REDIS_URL;
    });

    const expect503 = (p: Promise<unknown>) => expect(p).rejects.toBeInstanceOf(ServiceUnavailableError);

    it('challengeStore: issuing and consuming a challenge both 503', async () => {
        await expect503(challengeStore.setChallenge('k', 'v'));
        await expect503(challengeStore.takeChallenge('k'));
    });

    it('refreshToken: issue, rotate and revoke all 503', async () => {
        await expect503(issueRefreshToken('user-1'));
        await expect503(rotateRefreshToken('family.secret'));
        await expect503(revokeRefreshToken('family.secret'));
    });

    it('recoveryStore: set, get and delete all 503', async () => {
        await expect503(recoveryStore.setRecovery('a@b.com', { codeHash: 'h', userId: 'u', attemptsLeft: 5 }));
        await expect503(recoveryStore.getRecovery('a@b.com'));
        await expect503(recoveryStore.deleteRecovery('a@b.com'));
    });

    it('a malformed refresh token is still a 401, not a 503 — validation runs before any Redis call', async () => {
        await expect(rotateRefreshToken('no-dot-here')).rejects.toMatchObject({ statusCode: 401 });
    });

    it('back on the in-memory backend, the same calls succeed', async () => {
        process.env.NODE_ENV = 'test';
        delete process.env.REDIS_URL;
        await expect(challengeStore.setChallenge('k', 'v')).resolves.toBeUndefined();
        await expect(challengeStore.takeChallenge('k')).resolves.toBe('v');
    });
});
