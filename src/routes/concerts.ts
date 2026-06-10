import {Router} from 'express';
import { IConcertController } from '../controllers/ConcertController';

export function createConcertRouter(concertController: IConcertController) {
    const router = Router();
    //Get all concerts
    router.get('/concerts', async (req, res) => concertController.getConcerts(req, res));
    //Get concert by ID
    router.get('/concerts/:id', async (req, res) => concertController.getConcertById(req, res));
    return router;
}
