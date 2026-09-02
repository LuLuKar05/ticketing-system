import { z } from 'zod';

// POST /api/v1/orders/:id/confirm
export const confirmOrderParamsSchema = z
    .object({
        id: z.string().uuid(),
    })
    .strict();
// No body fields — the payer is the authenticated user (requireAuth). `.strict()` still rejects any
// stray fields (mass-assignment protection).
export const confirmOrderBodySchema = z.object({}).strict();

export type ConfirmOrderBody = z.infer<typeof confirmOrderBodySchema>;
