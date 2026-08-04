import { Router, json, RequestHandler } from 'express';
import { IOrderController } from '../controllers/OrderController';
import { validate } from '../middleware/validate';
import { confirmOrderParamsSchema, confirmOrderBodySchema } from '../dtos/confirmOrder.dto';

// Tiny body — just a userId. Reject anything bigger at parse time (OWASP API4).
const smallBody = json({ limit: '16kb' });

export function createOrderRouter(orderController: IOrderController, rateLimiter: RequestHandler) {
    const router = Router();
    // Confirm payment for an order. rateLimiter FIRST — a payment endpoint returns 429 on abuse
    // (never silently drops), so the client can back off; double-clicks are handled by the order
    // status check (422 if already confirmed), not the limiter.
    router.post(
        '/orders/:id/confirm',
        rateLimiter,
        smallBody,
        validate(confirmOrderParamsSchema, 'params'),
        validate(confirmOrderBodySchema, 'body'),
        async (req, res) => orderController.confirmOrder(req, res),
    );
    return router;
}
