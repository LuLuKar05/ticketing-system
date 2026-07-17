import { z } from 'zod';
import { createDocument } from 'zod-openapi';
import { reserveSchema } from '../dtos/reserve.dto';
import { confirmOrderParamsSchema, confirmOrderBodySchema } from '../dtos/confirmOrder.dto';
import { concertIdParamSchema, getConcertsQuerySchema } from '../dtos/concert.dto';
import { seatImportSchema } from '../dtos/seat.dto';

/**
 * OpenAPI document, generated FROM the zod DTOs that also drive runtime validation
 * (`validate(schema)` on the routes). Request shapes therefore cannot drift from the
 * docs — editing a DTO updates both. Response bodies are not zod-validated anywhere
 * (services shape them ad hoc), so the response schemas below are declarative only.
 *
 * Served by createApp() at:  GET /api/v1/docs  (Swagger UI)  ·  GET /api/v1/openapi.json
 */

// ---- Response envelopes (declarative — mirror the `{ status, message, data }` convention) ----

const success = <T extends z.ZodType>(data?: T) =>
    z.object({
        status: z.literal('success'),
        message: z.string(),
        ...(data ? { data } : {}),
    });

const errorEnvelope = z.object({
    status: z.literal('error'),
    message: z.string(),
});

const validationError = errorEnvelope.extend({
    errors: z.array(z.object({}).loose()).optional().meta({ description: 'zod issues' }),
});

const seatsUnavailableError = errorEnvelope.extend({
    seatNumbers: z.array(z.string()),
    reason: z.enum(['sold', 'held']),
});

const jsonContent = <T extends z.ZodType>(schema: T) => ({ 'application/json': { schema } });

const concertSummary = z.object({
    id: z.uuid(),
    name: z.string(),
    concertDate: z.iso.datetime(),
    imageUrl: z.string(),
    location: z.string(),
    artist: z.array(z.string()),
    genre: z.array(z.string()),
    totalTickets: z.int(),
    ageRestriction: z.int(),
    status: z.enum(['upcoming', 'ongoing', 'past', 'cancelled', 'rescheduled']),
});

const tier = z.object({ id: z.uuid(), name: z.string(), price: z.int().meta({ description: 'minor units (cents)' }) });

const seatStatus = z.object({
    seatNumber: z.string(),
    section: z.string().nullable(),
    row: z.string().nullable(),
    tier,
    status: z.enum(['available', 'held', 'sold']),
});

const order = z.object({
    id: z.uuid(),
    status: z.enum(['pending', 'confirmed', 'cancelled', 'failed']),
    totalAmount: z.int().nullable().meta({ description: 'minor units; null until confirmed' }),
});

const ticket = z.object({
    id: z.uuid(),
    seatNumber: z.string(),
    status: z.enum(['sold', 'cancelled', 'refunded']),
    pricePaid: z.int().nullable(),
});

// ---- The document ----

export const openApiDoc = createDocument({
    openapi: '3.1.0',
    info: {
        title: 'Concert Ticketing System API',
        version: '1.0.0',
        description:
            'Hard-hold, create-on-pay seat reservation API. Seat exclusivity is enforced by ' +
            'partial unique indexes in the database; holds expire after 5 minutes; seat-state ' +
            'changes are pushed over socket.io (`seat:held` / `seat:sold` / `seat:released`, ' +
            'rooms per concert). `userId` in request bodies is temporary until JWT auth (Phase 6a).',
    },
    servers: [{ url: 'http://localhost:{port}', variables: { port: { default: '5000' } } }],
    paths: {
        '/api/v1/concerts': {
            get: {
                tags: ['Concerts'],
                summary: 'List concerts',
                description: 'Defaults to upcoming + ongoing; `?status=` filters by one status, `?status=all` lists every status.',
                requestParams: { query: getConcertsQuerySchema },
                responses: {
                    '200': { description: 'Concert list', content: jsonContent(success(z.array(concertSummary))) },
                    '400': { description: 'Invalid status filter', content: jsonContent(validationError) },
                },
            },
        },
        '/api/v1/concerts/{id}': {
            get: {
                tags: ['Concerts'],
                summary: 'Get a concert (with its ticket tiers)',
                requestParams: { path: concertIdParamSchema },
                responses: {
                    '200': { description: 'Concert detail', content: jsonContent(success(concertSummary.extend({ ticketTiers: z.array(tier) }))) },
                    '400': { description: 'Malformed id (not a UUID)', content: jsonContent(validationError) },
                    '404': { description: 'Concert not found', content: jsonContent(errorEnvelope) },
                },
            },
        },
        '/api/v1/concerts/{id}/seats': {
            get: {
                tags: ['Seats'],
                summary: 'Live seat map (availability read model)',
                description:
                    'The seat catalog merged with live state — the baseline a client renders, then applies the WebSocket deltas onto.',
                requestParams: { path: concertIdParamSchema },
                responses: {
                    '200': {
                        description: 'Seat map with per-seat status',
                        content: jsonContent(success(z.object({ concertId: z.uuid(), seats: z.array(seatStatus) }))),
                    },
                    '404': { description: 'Concert not found', content: jsonContent(errorEnvelope) },
                },
            },
            post: {
                tags: ['Seats'],
                summary: 'Import / replace a concert seat map (admin)',
                description:
                    'Full-replace of the venue layout from one JSON document; each seat references its tier by name, ' +
                    'resolved against this concert\'s tiers. Refused once any seat is sold or held. Unauthenticated until Phase 6a.',
                requestParams: { path: concertIdParamSchema },
                requestBody: { content: jsonContent(seatImportSchema) },
                responses: {
                    '201': { description: 'Layout imported', content: jsonContent(success(z.object({ inserted: z.int() }))) },
                    '400': { description: 'Validation failed / unknown tier name', content: jsonContent(validationError) },
                    '404': { description: 'Concert not found', content: jsonContent(errorEnvelope) },
                    '409': { description: 'Concert already has sold or held seats', content: jsonContent(errorEnvelope) },
                },
            },
        },
        '/api/v1/reserves': {
            post: {
                tags: ['Reserves'],
                summary: 'Hold seats (5-minute exclusive hold)',
                description:
                    'Creates one Order + one PENDING reserve per seat, all-or-nothing. Seats are seat numbers only — ' +
                    'each seat\'s tier and price are derived server-side from the seat catalog.',
                requestBody: { content: jsonContent(reserveSchema) },
                responses: {
                    '201': { description: 'Seats held', content: jsonContent(success(z.object({ order }))) },
                    '400': { description: 'Validation failed, or a seat is not in the concert\'s catalog', content: jsonContent(validationError) },
                    '404': { description: 'Concert not found', content: jsonContent(errorEnvelope) },
                    '409': { description: 'One or more seats already sold/held', content: jsonContent(seatsUnavailableError) },
                },
            },
        },
        '/api/v1/orders/{id}/confirm': {
            post: {
                tags: ['Orders'],
                summary: 'Confirm (pay for) an order',
                description:
                    'Creates the SOLD tickets, confirms the reserves and totals the order in one all-or-nothing transaction. ' +
                    'Payment gateway integration is Phase 6b — currently assumes payment succeeds.',
                requestParams: { path: confirmOrderParamsSchema },
                requestBody: { content: jsonContent(confirmOrderBodySchema) },
                responses: {
                    '200': { description: 'Order confirmed, tickets issued', content: jsonContent(success(z.object({ order, tickets: z.array(ticket) }))) },
                    '400': { description: 'Invalid order id or body', content: jsonContent(validationError) },
                    '404': { description: 'Order not found', content: jsonContent(errorEnvelope) },
                    '409': { description: 'A seat was sold out from under the order (rolled back)', content: jsonContent(seatsUnavailableError) },
                    '410': { description: 'A hold in the order expired', content: jsonContent(errorEnvelope) },
                    '422': { description: 'Order not payable (already confirmed / cancelled / not yours)', content: jsonContent(errorEnvelope) },
                },
            },
        },
    },
});
