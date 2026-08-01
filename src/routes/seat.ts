import { Router } from 'express';
import { ISeatController } from '../controllers/SeatController';
import { validate } from '../middleware/validate';
import { concertIdParamSchema } from '../dtos/concert.dto';
import { seatImportSchema } from '../dtos/seat.dto';

export function createSeatRouter(seatController: ISeatController) {
    const router = Router();
    // Public: the seat map + live availability (the client's baseline for WS deltas).
    router.get('/concerts/:id/seats', validate(concertIdParamSchema, 'params'), async (req, res) =>
        seatController.getSeatMap(req, res),
    );
    // Admin: import/replace a concert's seat map. (Real admin auth arrives in Phase 6a.)
    router.post(
        '/concerts/:id/seats',
        validate(concertIdParamSchema, 'params'),
        validate(seatImportSchema, 'body'),
        async (req, res) => seatController.importSeatMap(req, res),
    );
    return router;
}
