import { resolveSocketUser } from '../../src/sockets/socketServer';
import { signAccessToken } from '../../src/auth/jwt';

// The io.use wiring is trivial; the substance is token extraction + verification, tested here
// against real (dev-keypair) tokens — no live socket needed.
describe('WebSocket handshake auth (resolveSocketUser)', () => {
    const token = signAccessToken({ sub: 'u1', role: 'admin' });

    it('reads a valid token from the access_token cookie', () => {
        expect(resolveSocketUser({ headers: { cookie: `access_token=${token}` } })).toEqual({
            id: 'u1',
            role: 'admin',
        });
    });

    it('reads a valid token from the handshake auth field', () => {
        expect(resolveSocketUser({ auth: { token }, headers: {} })).toEqual({ id: 'u1', role: 'admin' });
    });

    it('returns null (anonymous) when no token is present', () => {
        expect(resolveSocketUser({ headers: {} })).toBeNull();
    });

    it('throws on a present-but-invalid token (connection would be rejected)', () => {
        expect(() => resolveSocketUser({ headers: { cookie: 'access_token=garbage' } })).toThrow();
    });

    it('prefers the auth field over the cookie', () => {
        expect(resolveSocketUser({ auth: { token }, headers: { cookie: 'access_token=garbage' } })).toEqual({
            id: 'u1',
            role: 'admin',
        });
    });
});
