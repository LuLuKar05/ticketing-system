import { Router, json, RequestHandler } from 'express';
import { IReserveController } from '../controllers/ReserveController';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/requireAuth';
import { reserveSchema } from '../dtos/reserve.dto';

// Tiny body — a hold is at most 5 short seat labels + a concert UUID. Reject anything bigger at parse time.
const smallBody = json({ limit: '16kb' });

export function createReserveRouter(
    reserveController: IReserveController,
    rateLimiter: RequestHandler,
    activePass?: RequestHandler,
) {
    const router = Router();
    // rateLimiter FIRST (reject a flood by IP), then requireAuth (identity from the token), then
    // parse + validate the body. `activePass` (waiting-room gate) runs last — it needs both the
    // authenticated user and the validated concertId. Hold seats — body: { concertId, seats }.
    const guards: RequestHandler[] = [rateLimiter, requireAuth, smallBody, validate(reserveSchema)];
    if (activePass) guards.push(activePass);
    router.post('/reserves', ...guards, async (req, res) => reserveController.reserveTickets(req, res));
    return router;
}
