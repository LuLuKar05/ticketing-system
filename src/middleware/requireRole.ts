import { Request, Response, NextFunction } from 'express';
import { ForbiddenError, UnauthorizedError } from '../error';

/**
 * Authorize by role. MUST be chained AFTER `requireAuth`, which populates `req.user` from the
 * verified session token. The role is trusted only from that signed JWT claim — never from a
 * client-supplied header (which would be spoofable).
 *
 * Usage: `router.post('/x', requireAuth, requireRole('admin'), handler)`
 */
export function requireRole(...roles: string[]) {
    return (req: Request, _res: Response, next: NextFunction): void => {
        if (!req.user) return next(new UnauthorizedError());
        if (!roles.includes(req.user.role)) return next(new ForbiddenError());
        next();
    };
}
