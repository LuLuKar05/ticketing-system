import { Router, json, RequestHandler } from 'express';
import { ISeatController } from '../controllers/SeatController';
import { validate } from '../middleware/validate';
import { concertIdParamSchema } from '../dtos/concert.dto';
import { seatImportSchema } from '../dtos/seat.dto';

// Admin bulk import: a whole venue layout can be large, so a bigger limit than the tiny
// hold/confirm bodies — but still bounded (OWASP API4), paired with the schema's seats.max(10000).
const importBody = json({ limit: '1mb' });

export function createSeatRouter(seatController: ISeatController, rateLimiter: RequestHandler) {
    const router = Router();
    // Public: the seat map + live availability (the client's baseline for WS deltas). No body, no limit.
    router.get('/concerts/:id/seats', validate(concertIdParamSchema, 'params'), async (req, res) =>
        seatController.getSeatMap(req, res),
    );
    // Admin: import/replace a concert's seat map — rate-limited because it's UNAUTHENTICATED and
    // destructive (delete + rebuild) until admin auth (Phase 6a) lands.
    router.post(
        '/concerts/:id/seats',
        rateLimiter,
        importBody,
        validate(concertIdParamSchema, 'params'),
        validate(seatImportSchema, 'body'),
        async (req, res) => seatController.importSeatMap(req, res),
    );
    return router;
}
