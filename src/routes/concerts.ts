import {Router} from 'express';
import { IConcertController } from '../controllers/ConcertController';
import { validate } from '../middleware/validate';
import { concertIdParamSchema, getConcertsQuerySchema } from '../dtos/concert.dto';

export function createConcertRouter(concertController: IConcertController) {
    const router = Router();
    //Get all concerts (optional ?status= filter, validated against the ConcertStatus enum)
    router.get('/concerts', validate(getConcertsQuerySchema, 'query'), async (req, res) => concertController.getConcerts(req, res));
    //Get concert by ID (path param validated as a UUID → 400 on a malformed id)
    router.get('/concerts/:id', validate(concertIdParamSchema, 'params'), async (req, res) => concertController.getConcertById(req, res));
    return router;
}
