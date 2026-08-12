import { Router, json, RequestHandler } from 'express';
import { IReserveController } from '../controllers/ReserveController';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/requireAuth';
import { reserveSchema } from '../dtos/reserve.dto';

// Tiny body — a hold is at most 5 short seat labels + a concert UUID. Reject anything bigger at parse time.
const smallBody = json({ limit: '16kb' });

export function createReserveRouter(reserveController: IReserveController, rateLimiter: RequestHandler) {
    const router = Router();
    // rateLimiter FIRST (reject a flood by IP), then requireAuth (identity comes from the token, not
    // the body), then parse/validate. Hold seats — validated body: { concertId, seats: string[] }.
    router.post('/reserves', rateLimiter, requireAuth, smallBody, validate(reserveSchema), async (req, res) =>
        reserveController.reserveTickets(req, res),
    );
    return router;
}
