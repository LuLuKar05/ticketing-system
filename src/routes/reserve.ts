import { Router, json } from 'express';
import { IReserveController } from '../controllers/ReserveController';
import { validate } from '../middleware/validate';
import { reserveSchema } from '../dtos/reserve.dto';

// Tiny body — a hold is at most 5 short seat labels + two UUIDs. Reject anything bigger at parse time.
const smallBody = json({ limit: '16kb' });

export function createReserveRouter(reserveController: IReserveController) {
    const router = Router();
    //Hold seats (validated body: { userId, concertId, seats: string[] })
    router.post('/reserves', smallBody, validate(reserveSchema), async (req, res) =>
        reserveController.reserveTickets(req, res),
    );
    return router;
}
