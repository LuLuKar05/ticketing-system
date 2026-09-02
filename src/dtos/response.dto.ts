import { z } from 'zod';
import { Concert, ConcertStatus } from '../entities/Concert';
import { TicketTier } from '../entities/TicketTier';
import { Order, OrderStatus } from '../entities/Order';
import { Ticket, TicketStatus } from '../entities/Ticket';
import { Credential } from '../entities/Credential';

/**
 * RESPONSE contract — the "view model", deliberately separate from the persistence entities.
 *
 * These zod schemas are the SINGLE SOURCE OF TRUTH for what the API returns: the OpenAPI response
 * docs are generated from them (see docs/openapi.ts), AND the mapper functions below are typed as
 * `z.infer<schema>` so a mapper physically CANNOT return a field the schema doesn't declare — an
 * accidental leak (a relation, a timestamp, a future `internal_note`) becomes a compile error, not
 * a runtime surprise. This mirrors the request side, where one zod schema drives both validate()
 * and the request docs.
 */

// ---- schemas ----

export const tierSchema = z.object({
    id: z.uuid(),
    name: z.string(),
    price: z.int().meta({ description: 'minor units (cents)' }),
});

export const concertSummarySchema = z.object({
    id: z.uuid(),
    name: z.string(),
    concertDate: z.iso.datetime(),
    imageUrl: z.string(),
    location: z.string(),
    artist: z.array(z.string()),
    genre: z.array(z.string()),
    totalTickets: z.int(),
    ageRestriction: z.int(),
    status: z.nativeEnum(ConcertStatus),
});

// Detail view adds the fuller public fields (not the DB timestamps / no tier back-refs).
export const concertDetailSchema = concertSummarySchema.extend({
    description: z.string(),
    duration: z.int(),
    oneTicketPerUser: z.boolean(),
    ticketTiers: z.array(tierSchema),
});

export const seatStatusSchema = z.object({
    seatNumber: z.string(),
    section: z.string().nullable(),
    row: z.string().nullable(),
    tier: tierSchema,
    status: z.enum(['available', 'held', 'sold']),
});

export const orderSchema = z.object({
    id: z.uuid(),
    status: z.nativeEnum(OrderStatus),
    totalAmount: z.int().nullable().meta({ description: 'minor units; null until confirmed' }),
});

export const ticketSchema = z.object({
    id: z.uuid(),
    seatNumber: z.string(),
    status: z.nativeEnum(TicketStatus),
    pricePaid: z.int().nullable(),
});

// A user's registered passkey — sanitized: never expose the public key or raw credential id.
export const credentialSchema = z.object({
    id: z.uuid(),
    nickname: z.string().nullable(),
    deviceType: z.string().nullable(),
    backedUp: z.boolean(),
    createdAt: z.iso.datetime(),
    lastUsedAt: z.iso.datetime().nullable(),
});

// ---- types ----

export type TierResponse = z.infer<typeof tierSchema>;
export type ConcertSummaryResponse = z.infer<typeof concertSummarySchema>;
export type ConcertDetailResponse = z.infer<typeof concertDetailSchema>;
export type OrderResponse = z.infer<typeof orderSchema>;
export type TicketResponse = z.infer<typeof ticketSchema>;
export type CredentialResponse = z.infer<typeof credentialSchema>;

// ---- mappers (entity -> response DTO; explicit whitelist, enforced by the return types) ----

export function toTier(t: TicketTier): TierResponse {
    return { id: t.id, name: t.name, price: t.price };
}

export function toConcertSummary(c: Concert): ConcertSummaryResponse {
    return {
        id: c.id,
        name: c.name,
        concertDate: c.concertDate.toISOString(),
        imageUrl: c.imageUrl,
        location: c.location,
        artist: c.artist,
        genre: c.genre,
        totalTickets: c.totalTickets,
        ageRestriction: c.ageRestriction,
        status: c.status,
    };
}

export function toConcertDetail(c: Concert): ConcertDetailResponse {
    return {
        ...toConcertSummary(c),
        description: c.description,
        duration: c.duration,
        oneTicketPerUser: c.oneTicketPerUser,
        ticketTiers: (c.ticketTiers ?? []).map(toTier),
    };
}

export function toOrder(o: Order): OrderResponse {
    return { id: o.id, status: o.status, totalAmount: o.totalAmount ?? null };
}

export function toTicket(t: Ticket): TicketResponse {
    return { id: t.id, seatNumber: t.seatNumber, status: t.status, pricePaid: t.pricePaid ?? null };
}

export function toCredential(c: Credential): CredentialResponse {
    return {
        id: c.id,
        nickname: c.nickname ?? null,
        deviceType: c.deviceType ?? null,
        backedUp: c.backedUp,
        createdAt: c.createdAt.toISOString(),
        lastUsedAt: c.lastUsedAt ? c.lastUsedAt.toISOString() : null,
    };
}
