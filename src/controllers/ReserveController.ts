import { Request, Response } from 'express';
import { TicketUnavailableError, UserAlreadyHasTicketError } from '../error';
import {IReserveServiceParams, IReserveService} from '../services/ReserveService';
import {injectable, inject} from 'tsyringe';
/**
 * for the controller, instead of handling the error handling, all the error handling is done by the app.js(middleware), solve tghe DRY(Do not Repeat Yourself) principle, so the controller only handles the business logic and the app.js handles the error handling, this is a good practice because it keeps the code clean and maintainable.
 * 
 * The controller is responsible for handling the HTTP requests and responses, while the service is responsible for handling the business logic. The controller should not be concerned with how the service handles errors, it should only be concerned with how to respond to the client.
 * 
 * The service should throw errors when something goes wrong, and the controller should catch those errors and pass them to the error handling middleware. This way, the controller does not have to worry about how to handle different types of errors, and the error handling middleware can handle all errors in a consistent way.
 * 
 * The error handling middleware should be the last middleware in the middleware stack, so that it can catch any errors that are thrown by the controller or service. The error handling middleware should log the error and send a response to the client with the appropriate status code and message.
 * 
 * This way, the controller and service can focus on their respective responsibilities, and the error handling middleware can handle all errors in a consistent way.
 */



export interface IReserveController {
    reserveTickets(req: Request, res: Response): Promise<void>;
}
@injectable()
export class ReserveController implements IReserveController{
    constructor(@inject('IReserveService') private reserveService: IReserveService){}
    async reserveTickets(req: Request, res: Response): Promise<void>{
        const { userId, ticketId } = req.body;
        const result = await this.reserveService.reserveTickets({ userId, ticketId });
        res.status(201).json({
            status: 'success',
            message: 'Ticket reserved successfully',
            data: result,
        });
    }
}