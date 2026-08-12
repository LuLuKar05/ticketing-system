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

/** Begin passkey login — the account email (usernameless/discoverable login is a later addition). */
export const loginOptionsSchema = z
    .object({
        email: z.string().email().max(255),
    })
    .strict();
export type LoginOptionsDTO = z.infer<typeof loginOptionsSchema>;

/** Finish passkey login — the assertion produced by the browser. */
export const loginVerifySchema = z
    .object({
        email: z.string().email().max(255),
        response: z.object({ id: z.string() }).loose(),
    })
    .strict();
export type LoginVerifyDTO = z.infer<typeof loginVerifySchema>;
