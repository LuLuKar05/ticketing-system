import { z } from 'zod';

/**
 * POST /api/v1/concerts/:id/seats — the admin seat-map import.
 * The whole layout is uploaded as one JSON document; each seat references its tier BY NAME
 * (resolved against the concert's tiers on import). `row` maps to the entity's `rowLabel`.
 */
export const seatImportSchema = z
    .object({
        seats: z
            .array(
                z
                    .object({
                        seatNumber: z.string().min(1).max(20),
                        section: z.string().max(50).optional(),
                        row: z.string().max(50).optional(),
                        tierName: z.string().min(1).max(100),
                    })
                    // strict per seat too (OWASP API3): no stray fields inside a seat entry.
                    .strict(),
            )
            .min(1, 'At least one seat is required')
            // Bounds (OWASP API4): cap the bulk import so one request can't be unbounded.
            .max(10000, 'At most 10000 seats per import'),
    })
    .strict()
    .refine((data) => new Set(data.seats.map((s) => s.seatNumber)).size === data.seats.length, {
        message: 'Duplicate seatNumbers in the import',
    });

export type SeatImportDTO = z.infer<typeof seatImportSchema>;
