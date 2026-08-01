import { Request, Response } from 'express';
import { ConcertStatus } from '../entities/Concert';
import { IConcertService } from '../services/ConcertService';
import { injectable, inject } from 'tsyringe';

export interface IConcertController {
    getConcerts(req: Request, res: Response): Promise<void>;
    getConcertById(req: Request, res: Response): Promise<void>;
    cancelConcertById(req: Request, res: Response): Promise<void>;
}

@injectable()
export class ConcertController implements IConcertController {
    constructor(@inject('IConcertService') private concertService: IConcertService) {}
    async getConcerts(req: Request, res: Response): Promise<void> {
        const { status } = req.query;
        const concerts = await this.concertService.getConcerts({ status: status as ConcertStatus });
        res.status(200).json({
            status: 'success',
            message: 'Concerts fetched successfully',
            data: concerts,
            metadata: {
                total: concerts.length,
            },
        });
    }
    async getConcertById(req: Request, res: Response): Promise<void> {
        // id is a path param (validated as a UUID by the route). Not-found is thrown
        // by the service and mapped to 404 by the central error middleware.
        const id = req.params.id as string;
        const concert = await this.concertService.getConcertById(id);
        res.status(200).json({
            status: 'success',
            message: 'Concert found',
            data: concert,
        });
    }

    async cancelConcertById(req: Request, res: Response): Promise<void> {
        const id = req.params.id as string;
        await this.concertService.cancelConcertById(id);
        res.status(200).json({
            status: 'success',
            message: 'Concert cancelled successfully',
        });
    }
}
