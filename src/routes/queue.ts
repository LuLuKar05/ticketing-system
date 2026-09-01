import { Router, json, RequestHandler } from 'express';
import { IQueueController } from '../controllers/QueueController';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/requireAuth';
import { requireRole } from '../middleware/requireRole';
import { UserRole } from '../auth/roles';
import { concertIdParamSchema } from '../dtos/concert.dto';
import { gatingSchema } from '../dtos/queue.dto';

const smallBody = json({ limit: '4kb' });

export function createQueueRouter(queueController: IQueueController, rateLimiter: RequestHandler) {
    const router = Router();
    // Join the waiting room for a concert (rate-limited; identity from the token).
    router.post(
        '/concerts/:id/queue/join',
        rateLimiter,
        requireAuth,
        validate(concertIdParamSchema, 'params'),
        (req, res) => queueController.join(req, res),
    );
    // Poll your position / admission (cheap read — no rate limit needed).
    router.get('/concerts/:id/queue/status', requireAuth, validate(concertIdParamSchema, 'params'), (req, res) =>
        queueController.status(req, res),
    );
    // Admin: turn the waiting room on/off for a concert.
    router.patch(
        '/concerts/:id/queue/gating',
        requireAuth,
        requireRole(UserRole.ADMIN),
        smallBody,
        validate(concertIdParamSchema, 'params'),
        validate(gatingSchema, 'body'),
        (req, res) => queueController.setGating(req, res),
    );
    return router;
}
