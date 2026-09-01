import { Router, RequestHandler } from 'express';
import { IQueueController } from '../controllers/QueueController';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/requireAuth';
import { concertIdParamSchema } from '../dtos/concert.dto';

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
    return router;
}
