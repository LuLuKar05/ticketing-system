import { z } from 'zod';

/**
 * DTO for POST /api/v1/reserves — the "hold seats" request.
 * Seats are just seat numbers; the tier is derived server-side from the seat catalog
 * (so the client can't pick a cheaper tier for a seat).
 */
export const reserveSchema = z
    .object({
        // userId is NOT taken from the body — it comes from the authenticated session (requireAuth).
        concertId: z.string().uuid(),
        seats: z
            // Bounds (OWASP API4 — resource consumption): each seat label is short; a request
            // holds at most 5 seats (the brief's "quantity 1–5", on our seat model).
            .array(z.string().min(1).max(20))
            .min(1, 'At least one seat is required')
            .max(5, 'At most 5 seats per request')
            .refine((seats) => new Set(seats).size === seats.length, { message: 'Duplicate seats in the request' }),
    })
    // strict (OWASP API3 — mass assignment): reject unknown properties instead of stripping them.
    .strict();

export type ReserveDTO = z.infer<typeof reserveSchema>;
