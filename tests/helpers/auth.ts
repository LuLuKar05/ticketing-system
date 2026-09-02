import { signAccessToken } from '../../src/auth/jwt';

/**
 * A Bearer `Authorization` header for a user id — lets API tests authenticate without running the
 * full passkey ceremony. The dev ephemeral RS256 keypair is stable within a test process, so a
 * token signed here verifies in requireAuth. Spread into supertest: `.set(...bearer(userId))`.
 */
export function bearer(userId: string, role = 'customer'): [string, string] {
    return ['Authorization', `Bearer ${signAccessToken({ sub: userId, role })}`];
}
