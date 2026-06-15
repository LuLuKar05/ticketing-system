import express from 'express';
import { Request, Response, NextFunction } from 'express'; //This is for the error-handling middleware
import { TicketUnavailableError, UserAlreadyHasTicketError } from './error';
import {createConcertRouter} from './routes/concerts';
import {createReserveRouter} from './routes/reserve';
import { IReserveController } from './controllers/ReserveController';
import { IConcertController } from './controllers/ConcertController';


export function createApp({concertController, reserveController} : {concertController: IConcertController, reserveController: IReserveController}) {
    const app = express();
    app.use(express.json());
    app.use('/api/v1', createConcertRouter(concertController));
    app.use('/api/v1', createReserveRouter(reserveController));

    //404 - Not Found Middleware
    app.use((req: Request, res: Response) => {
        res.status(404).json({
            status: 'error',
            message: 'Resource not found',
        });
    });

    //Error handling middleware
    app.use((error: Error, req: Request, res: Response, next: NextFunction) => {
        console.error('Unhandled error:', error);
        if (error instanceof TicketUnavailableError) {
            res.status(422).json({
                status: 'error',
                message: error.message,
            });
        } else if (error instanceof UserAlreadyHasTicketError) {
            res.status(400).json({
                status: 'error',
                message: error.message,
            });
        } else {
            res.status(500).json({
                status: 'error',
                message: 'Internal server error',
            });
        }
    });
    return app;
}

