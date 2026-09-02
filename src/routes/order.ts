import { Router, json, RequestHandler } from 'express';
import { IOrderController } from '../controllers/OrderController';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/requireAuth';
import { confirmOrderParamsSchema, confirmOrderBodySchema } from '../dtos/confirmOrder.dto';

// Empty body — the payer is the authenticated user. Reject anything bigger at parse time (OWASP API4).
const smallBody = json({ limit: '16kb' });

export function createOrderRouter(orderController: IOrderController, rateLimiter: RequestHandler) {
    const router = Router();
    // Confirm payment for an order. rateLimiter FIRST — a payment endpoint returns 429 on abuse
    // (never silently drops); then requireAuth — only the order's owner (from the token) can pay.
    // Idempotent replay handles double-clicks (200 with the same tickets), not the limiter.
    router.post(
        '/orders/:id/confirm',
        rateLimiter,
        requireAuth,
        smallBody,
        validate(confirmOrderParamsSchema, 'params'),
        validate(confirmOrderBodySchema, 'body'),
        async (req, res) => orderController.confirmOrder(req, res),
    );
    return router;
}
