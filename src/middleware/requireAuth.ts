import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../auth/jwt';
import { SESSION_COOKIE_NAME } from '../auth/cookie';
import { UnauthorizedError } from '../error';

/**
 * Gate a route behind a valid session token. The token is accepted from EITHER an
 * `Authorization: Bearer <token>` header (API/mobile clients) OR the httpOnly session cookie
 * (browsers) — so the same API serves any frontend. On success `req.user` is set for downstream
 * handlers; otherwise a 401 is forwarded to the central error handler.
 */
function extractToken(req: Request): string | null {
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) return header.slice('Bearer '.length);
    const cookies = req.cookies as Record<string, string> | undefined;
    return cookies?.[SESSION_COOKIE_NAME] ?? null;
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
    const token = extractToken(req);
    if (!token) return next(new UnauthorizedError('Authentication required.'));
    try {
        const claims = verifyAccessToken(token);
        req.user = { id: claims.sub, role: claims.role };
        next();
    } catch {
        next(new UnauthorizedError('Invalid or expired session token.'));
    }
}
