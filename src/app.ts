import express from 'express';
import { Request, Response, NextFunction } from 'express'; //This is for the error-handling middleware
import { ZodError } from 'zod';
import { TicketUnavailableError, UserAlreadyHasTicketError, SeatsUnavailableError, NotFoundError, ReserveExpiredError } from './error';
import {createConcertRouter} from './routes/concerts';
import {createReserveRouter} from './routes/reserve';
import {createOrderRouter} from './routes/order';
import { IReserveController } from './controllers/ReserveController';
import { IConcertController } from './controllers/ConcertController';
import { IOrderController } from './controllers/OrderController';


export function createApp({concertController, reserveController, orderController} : {concertController: IConcertController, reserveController: IReserveController, orderController: IOrderController}) {
    const app = express();
    app.use(express.json());
    app.use('/api/v1', createConcertRouter(concertController));
    app.use('/api/v1', createReserveRouter(reserveController));
    app.use('/api/v1', createOrderRouter(orderController));

    //404 - Not Found Middleware
    app.use((req: Request, res: Response) => {
        res.status(404).json({
            status: 'error',
            message: 'Resource not found',
        });
    });

    //Error handling middleware — maps domain/validation errors to HTTP status codes.
    app.use((error: Error, req: Request, res: Response, next: NextFunction) => {
        // Zod validation failure (from the validate() middleware) -> 400 with details
        if (error instanceof ZodError) {
            res.status(400).json({ status: 'error', message: 'Validation failed', errors: error.issues });
            return;
        }
        // Malformed JSON body — express.json() throws a body-parser SyntaxError
        // tagged `type: 'entity.parse.failed'`. A client mistake is a 400, not a 500.
        if (error instanceof SyntaxError && (error as { type?: string }).type === 'entity.parse.failed') {
            res.status(400).json({ status: 'error', message: 'Malformed JSON in request body' });
            return;
        }
        // Requested seats already sold/held -> 409, with the exact seats for the UI
        if (error instanceof SeatsUnavailableError) {
            res.status(409).json({
                status: 'error',
                message: error.message,
                seatNumbers: error.seatNumbers,
                reason: error.reason,
            });
            return;
        }
        if (error instanceof NotFoundError) {
            res.status(404).json({ status: 'error', message: error.message });
            return;
        }
        if (error instanceof TicketUnavailableError) {
            res.status(422).json({ status: 'error', message: error.message });
            return;
        }
        if (error instanceof UserAlreadyHasTicketError) {
            res.status(400).json({ status: 'error', message: error.message });
            return;
        }
        if (error instanceof ReserveExpiredError) {
            res.status(410).json({ status: 'error', message: error.message });
            return;
        }
        console.error('Unhandled error:', error);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    });
    return app;
}

