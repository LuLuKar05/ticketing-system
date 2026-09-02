import { Request, Response } from 'express';
import { injectable, inject } from 'tsyringe';
import { IQueueService } from '../services/QueueService';
import { UnauthorizedError } from '../error';

export interface IQueueController {
    join(req: Request, res: Response): Promise<void>;
    status(req: Request, res: Response): Promise<void>;
    leave(req: Request, res: Response): Promise<void>;
    setGating(req: Request, res: Response): Promise<void>;
}

@injectable()
export class QueueController implements IQueueController {
    constructor(@inject('IQueueService') private queueService: IQueueService) {}

    async join(req: Request, res: Response): Promise<void> {
        const userId = req.user?.id;
        if (!userId) throw new UnauthorizedError();
        const result = await this.queueService.join(req.params.id as string, userId);
        res.status(200).json({ status: 'success', message: 'Queue joined', data: result });
    }

    async status(req: Request, res: Response): Promise<void> {
        const userId = req.user?.id;
        if (!userId) throw new UnauthorizedError();
        const result = await this.queueService.status(req.params.id as string, userId);
        res.status(200).json({ status: 'success', message: 'Queue status', data: result });
    }

    async leave(req: Request, res: Response): Promise<void> {
        const userId = req.user?.id;
        if (!userId) throw new UnauthorizedError();
        await this.queueService.leave(req.params.id as string, userId);
        res.status(204).send();
    }

    // Admin only (guarded by requireRole on the route).
    async setGating(req: Request, res: Response): Promise<void> {
        const { gatedOnSale } = req.body as { gatedOnSale: boolean };
        await this.queueService.setGating(req.params.id as string, gatedOnSale);
        res.status(200).json({ status: 'success', message: 'Queue gating updated', data: { gatedOnSale } });
    }
}
