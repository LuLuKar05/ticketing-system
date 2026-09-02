import { Response } from 'express';

/**
 * The session (access) token is delivered as an httpOnly cookie so browser clients are XSS-safe
 * (JS can't read it) and the token rides automatically on requests and the WebSocket handshake.
 * Non-browser clients ignore the cookie and use the token returned in the JSON body as a Bearer.
 */
export const SESSION_COOKIE_NAME = 'access_token';
export const REFRESH_COOKIE_NAME = 'refresh_token';
const MAX_AGE_MS = 15 * 60 * 1000; // aligns with the access-token TTL (15m)
// The refresh cookie is scoped to /api/v1/auth so it's only ever sent to the refresh + logout
// endpoints — it never rides along on ordinary API calls, shrinking its exposure.
const REFRESH_PATH = '/api/v1/auth';
const REFRESH_MAX_AGE_MS = Number(process.env.REFRESH_TTL_DAYS ?? 30) * 24 * 60 * 60 * 1000;

export function setSessionCookie(res: Response, token: string): void {
    res.cookie(SESSION_COOKIE_NAME, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production', // HTTPS-only in prod; plain http on localhost
        sameSite: 'lax', // sent on top-level navigations + same-site requests; blunts CSRF
        maxAge: MAX_AGE_MS,
        path: '/',
    });
}

export function clearSessionCookie(res: Response): void {
    res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
}

export function setRefreshCookie(res: Response, token: string): void {
    res.cookie(REFRESH_COOKIE_NAME, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: REFRESH_MAX_AGE_MS,
        path: REFRESH_PATH,
    });
}

export function clearRefreshCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_PATH });
}

// Correlates a login ceremony's challenge with the browser between /options and /verify — the
// mechanism that makes usernameless (discoverable / conditional-UI) login possible, since there's
// no email to key the challenge by. Opaque, short-lived, httpOnly.
export const LOGIN_CHALLENGE_COOKIE_NAME = 'login_id';
const LOGIN_CHALLENGE_MAX_AGE_MS = 5 * 60 * 1000; // matches the challenge TTL

export function setLoginChallengeCookie(res: Response, loginId: string): void {
    res.cookie(LOGIN_CHALLENGE_COOKIE_NAME, loginId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: LOGIN_CHALLENGE_MAX_AGE_MS,
        path: REFRESH_PATH, // '/api/v1/auth' — only sent to the auth endpoints
    });
}

export function clearLoginChallengeCookie(res: Response): void {
    res.clearCookie(LOGIN_CHALLENGE_COOKIE_NAME, { path: REFRESH_PATH });
}

// Correlates a recovery passkey ceremony between /recover/verify and /recover/complete, and proves
// this browser just passed the code check. Opaque, short-lived, httpOnly.
export const RECOVERY_COOKIE_NAME = 'recovery_id';

export function setRecoveryCookie(res: Response, recoveryId: string): void {
    res.cookie(RECOVERY_COOKIE_NAME, recoveryId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 10 * 60 * 1000,
        path: REFRESH_PATH,
    });
}

export function clearRecoveryCookie(res: Response): void {
    res.clearCookie(RECOVERY_COOKIE_NAME, { path: REFRESH_PATH });
}
