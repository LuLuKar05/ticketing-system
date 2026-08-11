import { Response } from 'express';

/**
 * The session (access) token is delivered as an httpOnly cookie so browser clients are XSS-safe
 * (JS can't read it) and the token rides automatically on requests and the WebSocket handshake.
 * Non-browser clients ignore the cookie and use the token returned in the JSON body as a Bearer.
 */
export const SESSION_COOKIE_NAME = 'access_token';
const MAX_AGE_MS = 15 * 60 * 1000; // aligns with the access-token TTL (15m)

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
