export enum UserRole {
    CUSTOMER = 'customer',
    ADMIN = 'admin',
}

/**
 * Resolve a user's role from the `ADMIN_EMAILS` allowlist (comma-separated env). Admin designation
 * is configuration, not code — add an email to `ADMIN_EMAILS` to promote; it takes effect on that
 * user's next login (when a fresh token is issued). The role is then carried in the signed JWT, so
 * it is never trusted from a client-supplied header.
 */
export function resolveRole(email: string): UserRole {
    const allow = (process.env.ADMIN_EMAILS ?? '')
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);
    return allow.includes(email.toLowerCase()) ? UserRole.ADMIN : UserRole.CUSTOMER;
}
