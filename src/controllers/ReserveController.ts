import { Request, Response } from 'express';
import { TicketUnavailableError, UserAlreadyHasTicketError } from '../error';
import {IReserveServiceParams, IReserveService} from '../services/ReserveService';
import {injectable, inject} from 'tsyringe';


export interface IReserveController {
    reserveTickets(req: Request, res: Response): Promise<void>;
}
@injectable()
export class ReserveController implements IReserveController{
    constructor(@inject('IReserveService') private reserveService: IReserveService){}
    async reserveTickets(req: Request, res: Response): Promise<void>{
        const { userId, ticketId } = req.body;
        try{
            const result = await this.reserveService.reserveTickets({ userId, ticketId });
            res.status(201).json({
                status: 'success',
                message: 'Ticket reserved successfully',
                data: result,
            });
        } catch(error){
            console.error('Error reserving ticket:', error);
            if (error instanceof TicketUnavailableError) {
                res.status(422).json({
                    status: 'error',
                    message: error.message,
                });
                return;
            } 
            if (error instanceof UserAlreadyHasTicketError) {
                res.status(400).json({
                    status: 'error',
                    message: error.message,
                });
                return;
            }
            res.status(500).json({
                status: 'error',
                message: 'Internal server error',
            });
        }
    }
}