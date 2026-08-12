import 'express';

/**
 * Augment Express's Request with the authenticated principal. Populated by the `requireAuth`
 * middleware from a verified session token; absent on unauthenticated requests.
 */
declare global {
    namespace Express {
        interface Request {
            user?: { id: string; role: string };
        }
    }
}
