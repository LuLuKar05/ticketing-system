import express from 'express';
import {createConcertRouter} from './routes/concerts';
import {createReserveRouter} from './routes/reserve';
import { IReserveController } from './controllers/ReserveController';
import { IConcertController } from './controllers/ConcertController';

export function createApp({concertController, reserveController} : {concertController: IConcertController, reserveController: IReserveController}) {
    const app = express();
    app.use(express.json());

    app.use('/api/v1', createConcertRouter(concertController));
    app.use('/api/v1', createReserveRouter(reserveController));
    return app;
}

