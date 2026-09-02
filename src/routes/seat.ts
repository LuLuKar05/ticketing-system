import { Router, json, RequestHandler } from 'express';
import { ISeatController } from '../controllers/SeatController';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/requireAuth';
import { requireRole } from '../middleware/requireRole';
import { UserRole } from '../auth/roles';
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
    // Admin only: import/replace a concert's seat map (destructive delete + rebuild). rateLimiter
    // first, then requireAuth, then requireRole('admin') — the role comes from the verified JWT.
    router.post(
        '/concerts/:id/seats',
        rateLimiter,
        requireAuth,
        requireRole(UserRole.ADMIN),
        importBody,
        validate(concertIdParamSchema, 'params'),
        validate(seatImportSchema, 'body'),
        async (req, res) => seatController.importSeatMap(req, res),
    );
    return router;
}
