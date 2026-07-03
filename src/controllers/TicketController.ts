import {Request, Response} from 'express';
import {injectable, inject} from 'tsyringe';
import {ITicketService} from '../services/TicketService';

export interface ITicketController {
    postTickets(req: Request, res: Response): Promise<void>;
    putRefundTicket(req: Request, res: Response): Promise<void>;
    putCancelTickets(req: Request, res: Response): Promise<void>;
}
/**
 * 
 * putCancelTickets:
 */

@injectable()
export class TicketController implements ITicketController {
    constructor(@inject('ITicketService') private ticketService: ITicketService){}

    async postTickets(req: Request, res: Response): Promise<void>{
        // In the create-on-pay model tickets are not created directly — they are issued
        // at payment via POST /api/v1/orders/:id/confirm.
        res.status(501).json({
            status: 'error',
            message: 'Not implemented: tickets are issued at payment (POST /orders/:id/confirm)',
        });
    }
    async putRefundTicket(req: Request, res: Response): Promise<void>{
        const { userId, ticketId, ticketTierId } = req.body;
        await this.ticketService.refundTicket({ userId, ticketId, ticketTierId });
        res.status(200).json({
            status: 'success',
            message: 'Ticket refunded successfully',
        });
    }
    async putCancelTickets(req: Request, res: Response): Promise<void>{
        const { concertId } = req.body;
            await this.ticketService.cancelAllTicketsByConcertId({ concertId });
            res.status(200).json({
                status: 'success',
                message: 'All tickets for the concert have been cancelled successfully',
            });
    }


}