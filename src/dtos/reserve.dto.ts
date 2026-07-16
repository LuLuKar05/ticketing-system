import { z } from 'zod';

/**
 * DTO for POST /api/v1/reserves — the "hold seats" request.
 * Seats are just seat numbers; the tier is derived server-side from the seat catalog
 * (so the client can't pick a cheaper tier for a seat).
 */
export const reserveSchema = z.object({
    userId: z.string().uuid(),
    concertId: z.string().uuid(),
    seats: z
        .array(z.string().min(1))
        .min(1, 'At least one seat is required')
        .refine((seats) => new Set(seats).size === seats.length, { message: 'Duplicate seats in the request' }),
});

export type ReserveDTO = z.infer<typeof reserveSchema>;
