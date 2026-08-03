import { z } from 'zod';

// POST /api/v1/orders/:id/confirm
export const confirmOrderParamsSchema = z
    .object({
        id: z.string().uuid(),
    })
    .strict();
export const confirmOrderBodySchema = z
    .object({
        userId: z.string().uuid(),
    })
    .strict();

export type ConfirmOrderBody = z.infer<typeof confirmOrderBodySchema>;
