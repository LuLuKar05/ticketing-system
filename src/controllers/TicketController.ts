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
        //const { concertId, userId } = req.body;
        // Implementation for posting tickets
    }
    async putRefundTicket(req: Request, res: Response): Promise<void>{
        req.params; // Expecting userId, ticketId, and ticketStatus in the request parameters
        req.body; // Additional data for refunding the ticket if needed
        const { userId,ticketId, ticketStatus } = req.body;
        try{
            await this.ticketService.refundTicket({userId, ticketId, ticketStatus});
        }catch(error){
            console.error('Error refunding ticket:', error);
            res.status(500).json({
                status: 'error',
                message: 'Internal server error',
            });
        }
    }
    async putCancelTickets(req: Request, res: Response): Promise<void>{
        const { concertId } = req.body;
        try{
            await this.ticketService.cancelAllTicketsByConcertId({ concertId });
            res.status(200).json({
                status: 'success',
                message: 'All tickets for the concert have been cancelled successfully',
            });
        }catch(error){
            console.error('Error cancelling tickets:', error);
            res.status(500).json({
                status: 'error',
                message: 'Internal server error',
            });
        }
    }


}