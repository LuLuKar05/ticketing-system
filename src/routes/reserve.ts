import {Router} from 'express';
import {reserveController} from '../container';

const router = Router();

//Reserve a ticket
router.post('/reserves', async (req, res) => reserveController.reserveTickets(req, res));

export default router;


