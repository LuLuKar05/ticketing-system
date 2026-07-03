import { z } from 'zod';

// POST /api/v1/orders/:id/confirm
export const confirmOrderParamsSchema = z.object({
    id: z.string().uuid(),
});
export const confirmOrderBodySchema = z.object({
    userId: z.string().uuid(),
});

export type ConfirmOrderBody = z.infer<typeof confirmOrderBodySchema>;
