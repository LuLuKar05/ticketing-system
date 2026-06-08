import {Router} from 'express';
import {concertController} from '../container';


const router = Router();
//Get all concerts
router.get('/concerts', async (req, res) => concertController.getConcerts(req, res));
//Get concert by ID
router.get('/concerts/:id', async (req, res) => concertController.getConcertById(req, res));
export default router;