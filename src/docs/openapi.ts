import { z } from 'zod';
import { createDocument } from 'zod-openapi';
import { reserveSchema } from '../dtos/reserve.dto';
import { confirmOrderParamsSchema, confirmOrderBodySchema } from '../dtos/confirmOrder.dto';
import { concertIdParamSchema, getConcertsQuerySchema } from '../dtos/concert.dto';
import { seatImportSchema } from '../dtos/seat.dto';
import {
    concertSummarySchema,
    concertDetailSchema,
    seatStatusSchema,
    orderSchema,
    ticketSchema,
} from '../dtos/response.dto';

/**
 * OpenAPI document, generated FROM the zod DTOs that also drive the runtime.
 * - Request shapes come from the same schemas the routes `validate()` with — can't drift.
 * - Response shapes come from the same schemas the response MAPPERS are typed against
 *   (`src/dtos/response.dto.ts`) — so the documented response is exactly what the API serializes.
 *
 * Served by createApp() at:  GET /api/v1/docs  (Swagger UI)  ·  GET /api/v1/openapi.json
 */

// ---- Response envelopes ----

const success = <T extends z.ZodType>(data?: T) =>
    z.object({
        status: z.literal('success'),
        message: z.string(),
        ...(data ? { data } : {}),
    });

// Error responses are uniform `{ error: CODE, message, ref }` (mapped in app.ts).
const errorEnvelope = z.object({
    error: z.string().meta({ description: 'machine-readable error code' }),
    message: z.string(),
    ref: z.string().meta({ description: 'correlation id — grep the logs by this' }),
});

const validationError = errorEnvelope.extend({
    details: z.array(z.object({}).loose()).optional().meta({ description: 'zod issues' }),
});

const seatsUnavailableError = errorEnvelope.extend({
    seatNumbers: z.array(z.string()),
    reason: z.enum(['sold', 'held']),
});

const jsonContent = <T extends z.ZodType>(schema: T) => ({ 'application/json': { schema } });

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
                description:
                    'Defaults to upcoming + ongoing; `?status=` filters by one status, `?status=all` lists every status.',
                requestParams: { query: getConcertsQuerySchema },
                responses: {
                    '200': {
                        description: 'Concert list',
                        content: jsonContent(success(z.array(concertSummarySchema))),
                    },
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
                    '200': {
                        description: 'Concert detail',
                        content: jsonContent(success(concertDetailSchema)),
                    },
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
                        content: jsonContent(
                            success(z.object({ concertId: z.uuid(), seats: z.array(seatStatusSchema) })),
                        ),
                    },
                    '404': { description: 'Concert not found', content: jsonContent(errorEnvelope) },
                },
            },
            post: {
                tags: ['Seats'],
                summary: 'Import / replace a concert seat map (admin)',
                description:
                    'Full-replace of the venue layout from one JSON document; each seat references its tier by name, ' +
                    "resolved against this concert's tiers. Refused once any seat is sold or held. Unauthenticated until Phase 6a.",
                requestParams: { path: concertIdParamSchema },
                requestBody: { content: jsonContent(seatImportSchema) },
                responses: {
                    '201': {
                        description: 'Layout imported',
                        content: jsonContent(success(z.object({ inserted: z.int() }))),
                    },
                    '400': {
                        description: 'Validation failed / unknown tier name',
                        content: jsonContent(validationError),
                    },
                    '404': { description: 'Concert not found', content: jsonContent(errorEnvelope) },
                    '409': {
                        description: 'Concert already has sold or held seats',
                        content: jsonContent(errorEnvelope),
                    },
                },
            },
        },
        '/api/v1/reserves': {
            post: {
                tags: ['Reserves'],
                summary: 'Hold seats (5-minute exclusive hold)',
                description:
                    'Creates one Order + one PENDING reserve per seat, all-or-nothing. Seats are seat numbers only — ' +
                    "each seat's tier and price are derived server-side from the seat catalog.",
                requestBody: { content: jsonContent(reserveSchema) },
                responses: {
                    '201': {
                        description: 'Seats held',
                        content: jsonContent(success(z.object({ order: orderSchema }))),
                    },
                    '400': {
                        description: "Validation failed, or a seat is not in the concert's catalog",
                        content: jsonContent(validationError),
                    },
                    '404': { description: 'Concert not found', content: jsonContent(errorEnvelope) },
                    '409': {
                        description: 'One or more seats already sold/held',
                        content: jsonContent(seatsUnavailableError),
                    },
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
                    '200': {
                        description:
                            'Order confirmed, tickets issued. Idempotent (keyed on order id): a repeated ' +
                            'confirm replays the same tickets instead of charging again.',
                        content: jsonContent(success(z.object({ order: orderSchema, tickets: z.array(ticketSchema) }))),
                    },
                    '400': { description: 'Invalid order id or body', content: jsonContent(validationError) },
                    '404': { description: 'Order not found', content: jsonContent(errorEnvelope) },
                    '409': {
                        description:
                            'A seat was sold out from under the order, or a concurrent confirm won (rolled back)',
                        content: jsonContent(seatsUnavailableError),
                    },
                    '410': { description: 'A hold in the order expired', content: jsonContent(errorEnvelope) },
                    '422': {
                        description: 'Order not payable (cancelled, or not yours)',
                        content: jsonContent(errorEnvelope),
                    },
                },
            },
        },
    },
});
