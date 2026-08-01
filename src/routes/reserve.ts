import { Router } from 'express';
import { IReserveController } from '../controllers/ReserveController';
import { validate } from '../middleware/validate';
import { reserveSchema } from '../dtos/reserve.dto';

export function createReserveRouter(reserveController: IReserveController) {
    const router = Router();
    //Hold seats (validated body: { userId, concertId, seats: [{ tierId, seatNumber }] })
    router.post('/reserves', validate(reserveSchema), async (req, res) => reserveController.reserveTickets(req, res));
    return router;
}
