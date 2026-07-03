import { Router } from 'express';
import { IOrderController } from '../controllers/OrderController';
import { validate } from '../middleware/validate';
import { confirmOrderParamsSchema, confirmOrderBodySchema } from '../dtos/confirmOrder.dto';

export function createOrderRouter(orderController: IOrderController) {
    const router = Router();
    // Confirm payment for an order (validated params + body)
    router.post(
        '/orders/:id/confirm',
        validate(confirmOrderParamsSchema, 'params'),
        validate(confirmOrderBodySchema, 'body'),
        async (req, res) => orderController.confirmOrder(req, res),
    );
    return router;
}
