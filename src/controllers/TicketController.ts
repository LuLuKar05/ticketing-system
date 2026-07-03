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
        const { concertId, seatNumber } = req.body;
        const ticket = await this.ticketService.createTicketForConcert({ concertId, seatNumber });
        res.status(201).json({
            status: 'success',
            message: 'Ticket created successfully',
            data: ticket,
        });
    }
    async putRefundTicket(req: Request, res: Response): Promise<void>{
        req.params;
        req.body;
        const { userId, ticketId, ticketStatus, ticketTierId } = req.body;
        await this.ticketService.refundTicket({userId, ticketId, ticketStatus, ticketTierId});
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