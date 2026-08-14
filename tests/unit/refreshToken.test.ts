import { issueRefreshToken, rotateRefreshToken, revokeRefreshToken } from '../../src/auth/refreshToken';

// NODE_ENV=test → the store is the in-memory fallback (no Redis needed).
describe('refresh tokens — rotation + reuse-detection (unit)', () => {
    it('issues a token that rotates to a fresh one', async () => {
        const t1 = await issueRefreshToken('u1');
        const rotated = await rotateRefreshToken(t1);
        expect(rotated.userId).toBe('u1');
        expect(rotated.token).not.toBe(t1);
    });

    it('rejects a malformed token', async () => {
        await expect(rotateRefreshToken('garbage')).rejects.toMatchObject({ name: 'UnauthorizedError' });
    });

    it('reusing an already-rotated token revokes the WHOLE family', async () => {
        const t1 = await issueRefreshToken('u1');
        const rotated = await rotateRefreshToken(t1); // t1 is now stale
        // Replaying the old token → reuse detected → family burned.
        await expect(rotateRefreshToken(t1)).rejects.toMatchObject({ name: 'UnauthorizedError' });
        // The previously-valid rotated token is now dead too (the family was revoked).
        await expect(rotateRefreshToken(rotated.token)).rejects.toMatchObject({ name: 'UnauthorizedError' });
    });

    it('revoke kills the family', async () => {
        const t1 = await issueRefreshToken('u1');
        await revokeRefreshToken(t1);
        await expect(rotateRefreshToken(t1)).rejects.toMatchObject({ name: 'UnauthorizedError' });
    });
});
