import { z } from 'zod';

/**
 * DTO for POST /api/v1/reserves — the "hold seats" request.
 * The zod schema is the single source of truth for both runtime validation and
 * the inferred TypeScript type (ReserveDTO).
 */
export const reserveSchema = z.object({
    userId: z.string().uuid(),
    concertId: z.string().uuid(),
    seats: z
        .array(
            z.object({
                tierId: z.string().uuid(),
                seatNumber: z.string().min(1),
            }),
        )
        .min(1, 'At least one seat is required'),
});

export type ReserveDTO = z.infer<typeof reserveSchema>;
