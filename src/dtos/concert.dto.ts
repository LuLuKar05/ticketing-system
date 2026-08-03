import { z } from 'zod';
import { ConcertStatus } from '../entities/Concert';

// GET /api/v1/concerts/:id  — the path param (concert ids are generated UUIDs).
export const concertIdParamSchema = z
    .object({
        id: z.string().uuid(),
    })
    .strict();

// GET /api/v1/concerts?status=...  — optional filter; must be a known status or 'all'.
// strict: an unexpected query param (?foo=bar) is rejected, not ignored.
export const getConcertsQuerySchema = z
    .object({
        status: z.union([z.nativeEnum(ConcertStatus), z.literal('all')]).optional(),
    })
    .strict();
