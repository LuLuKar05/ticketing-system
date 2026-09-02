import { z } from 'zod';

/** Admin: turn the waiting-room gate on/off for a concert. */
export const gatingSchema = z
    .object({
        gatedOnSale: z.boolean(),
    })
    .strict();
export type GatingDTO = z.infer<typeof gatingSchema>;
