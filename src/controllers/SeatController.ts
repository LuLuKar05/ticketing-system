import { Request, Response } from 'express';
import { injectable, inject } from 'tsyringe';
import { ISeatService } from '../services/SeatService';

export interface ISeatController {
    importSeatMap(req: Request, res: Response): Promise<void>;
    getSeatMap(req: Request, res: Response): Promise<void>;
}

@injectable()
export class SeatController implements ISeatController {
    constructor(@inject('ISeatService') private seatService: ISeatService) {}

    // POST /api/v1/concerts/:id/seats — body validated by seatImportSchema on the route.
    async importSeatMap(req: Request, res: Response): Promise<void> {
        const id = req.params.id as string;
        const result = await this.seatService.importSeatMap(id, req.body);
        res.status(201).json({ status: 'success', message: 'Seat map imported', data: result });
    }

    // GET /api/v1/concerts/:id/seats — the availability read model (catalog + live status).
    async getSeatMap(req: Request, res: Response): Promise<void> {
        const id = req.params.id as string;
        const result = await this.seatService.getSeatMapWithStatus(id);
        res.status(200).json({ status: 'success', message: 'Seat map', data: result });
    }
}
