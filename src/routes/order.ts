import { Router, json } from 'express';
import { IOrderController } from '../controllers/OrderController';
import { validate } from '../middleware/validate';
import { confirmOrderParamsSchema, confirmOrderBodySchema } from '../dtos/confirmOrder.dto';

// Tiny body — just a userId. Reject anything bigger at parse time (OWASP API4).
const smallBody = json({ limit: '16kb' });

export function createOrderRouter(orderController: IOrderController) {
    const router = Router();
    // Confirm payment for an order (validated params + body)
    router.post(
        '/orders/:id/confirm',
        smallBody,
        validate(confirmOrderParamsSchema, 'params'),
        validate(confirmOrderBodySchema, 'body'),
        async (req, res) => orderController.confirmOrder(req, res),
    );
    return router;
}
