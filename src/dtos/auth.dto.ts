import { z } from 'zod';

/** Begin passkey registration — only the account email (the account handle). */
export const registerOptionsSchema = z
    .object({
        email: z.string().email().max(255),
    })
    .strict();
export type RegisterOptionsDTO = z.infer<typeof registerOptionsSchema>;

/**
 * Finish passkey registration. `response` is the attestation produced by the browser; its full
 * shape is validated by @simplewebauthn — here we only assert the envelope (an object with an `id`)
 * and pass it through, so we never hand-roll WebAuthn parsing.
 */
export const registerVerifySchema = z
    .object({
        email: z.string().email().max(255),
        response: z.object({ id: z.string() }).loose(),
    })
    .strict();
export type RegisterVerifyDTO = z.infer<typeof registerVerifySchema>;

/**
 * Begin passkey login. `email` is OPTIONAL: when given, it seeds `allowCredentials` (a hint so the
 * browser offers that account's passkeys); when omitted, login is usernameless / discoverable — the
 * browser surfaces any passkey for this site (conditional UI / autofill).
 */
export const loginOptionsSchema = z
    .object({
        email: z.string().email().max(255).optional(),
    })
    .strict();
export type LoginOptionsDTO = z.infer<typeof loginOptionsSchema>;

/** Finish passkey login — just the assertion. The user is resolved from the passkey's credential id
 *  (no email needed), and the challenge is correlated via the login_id cookie. */
export const loginVerifySchema = z
    .object({
        response: z.object({ id: z.string() }).loose(),
    })
    .strict();
export type LoginVerifyDTO = z.infer<typeof loginVerifySchema>;

/** Finish adding a passkey to the logged-in account (an optional device label). */
export const addCredentialVerifySchema = z
    .object({
        response: z.object({ id: z.string() }).loose(),
        nickname: z.string().max(100).optional(),
    })
    .strict();
export type AddCredentialVerifyDTO = z.infer<typeof addCredentialVerifySchema>;

/** Path param for removing a passkey by its row id. */
export const credentialIdParamSchema = z
    .object({
        id: z.string().uuid(),
    })
    .strict();

/** Refresh / logout — the token normally rides in the httpOnly cookie; allow it in the body for
 *  non-browser clients. */
export const refreshBodySchema = z
    .object({
        refreshToken: z.string().max(512).optional(),
    })
    .strict();
export type RefreshBodyDTO = z.infer<typeof refreshBodySchema>;
