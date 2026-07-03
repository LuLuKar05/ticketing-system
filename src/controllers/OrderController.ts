import { Request, Response } from 'express';
import { injectable, inject } from 'tsyringe';
import { ITicketService } from '../services/TicketService';

export interface IOrderController {
    confirmOrder(req: Request, res: Response): Promise<void>;
}

@injectable()
export class OrderController implements IOrderController {
    constructor(@inject('ITicketService') private ticketService: ITicketService) {}

    // POST /api/v1/orders/:id/confirm  — body { userId } (validated). Errors are thrown
    // and mapped by the central error handler in app.ts.
    async confirmOrder(req: Request, res: Response): Promise<void> {
        const { id } = req.params;
        const { userId } = req.body;
        const result = await this.ticketService.confirmOrder({ orderId: id as string, userId });
        res.status(200).json({
            status: 'success',
            message: 'Order confirmed and tickets issued',
            data: result,
        });
    }
}
