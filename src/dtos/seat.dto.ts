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
                z.object({
                    seatNumber: z.string().min(1),
                    section: z.string().optional(),
                    row: z.string().optional(),
                    tierName: z.string().min(1),
                }),
            )
            .min(1, 'At least one seat is required'),
    })
    .refine((data) => new Set(data.seats.map((s) => s.seatNumber)).size === data.seats.length, {
        message: 'Duplicate seatNumbers in the import',
    });

export type SeatImportDTO = z.infer<typeof seatImportSchema>;
