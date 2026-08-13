import { resolveRole, UserRole } from '../../src/auth/roles';

describe('resolveRole (ADMIN_EMAILS allowlist)', () => {
    const original = process.env.ADMIN_EMAILS;
    afterEach(() => {
        if (original === undefined) delete process.env.ADMIN_EMAILS;
        else process.env.ADMIN_EMAILS = original;
    });

    it('returns customer when the allowlist is unset', () => {
        delete process.env.ADMIN_EMAILS;
        expect(resolveRole('a@b.com')).toBe(UserRole.CUSTOMER);
    });

    it('returns admin for a listed email — case- and space-insensitive', () => {
        process.env.ADMIN_EMAILS = 'boss@x.com, Admin@Y.com';
        expect(resolveRole('boss@x.com')).toBe(UserRole.ADMIN);
        expect(resolveRole('ADMIN@y.com')).toBe(UserRole.ADMIN);
    });

    it('returns customer for an unlisted email', () => {
        process.env.ADMIN_EMAILS = 'boss@x.com';
        expect(resolveRole('someone@else.com')).toBe(UserRole.CUSTOMER);
    });
});
