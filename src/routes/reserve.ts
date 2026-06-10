import {Router} from 'express';
import {IReserveController} from '../controllers/ReserveController';

export function createReserveRouter(reserveController: IReserveController) {
    const router = Router();
    //Reserve a ticket
    router.post('/reserves', async (req, res) => reserveController.reserveTickets(req, res));
    return router;
}

