import { Router } from 'express';
import { ISeatController } from '../controllers/SeatController';
import { validate } from '../middleware/validate';
import { concertIdParamSchema } from '../dtos/concert.dto';
import { seatImportSchema } from '../dtos/seat.dto';

export function createSeatRouter(seatController: ISeatController) {
    const router = Router();
    // Admin: import/replace a concert's seat map. (Real admin auth arrives in Phase 6a.)
    router.post(
        '/concerts/:id/seats',
        validate(concertIdParamSchema, 'params'),
        validate(seatImportSchema, 'body'),
        async (req, res) => seatController.importSeatMap(req, res),
    );
    return router;
}
