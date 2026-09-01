import { z } from 'zod';
import { createDocument } from 'zod-openapi';
import { reserveSchema } from '../dtos/reserve.dto';
import { confirmOrderParamsSchema, confirmOrderBodySchema } from '../dtos/confirmOrder.dto';
import {
    registerOptionsSchema,
    registerVerifySchema,
    loginOptionsSchema,
    loginVerifySchema,
    addCredentialVerifySchema,
    refreshBodySchema,
    recoverSchema,
    recoverVerifySchema,
    recoverCompleteSchema,
} from '../dtos/auth.dto';
import { concertIdParamSchema, getConcertsQuerySchema } from '../dtos/concert.dto';
import { gatingSchema } from '../dtos/queue.dto';
import { seatImportSchema } from '../dtos/seat.dto';
import {
    concertSummarySchema,
    concertDetailSchema,
    seatStatusSchema,
    orderSchema,
    ticketSchema,
    credentialSchema,
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
            'rooms per concert). Protected endpoints need a passkey session token, sent as a Bearer ' +
            'header or the httpOnly `access_token` cookie.',
    },
    servers: [{ url: 'http://localhost:{port}', variables: { port: { default: '5000' } } }],
    components: {
        securitySchemes: {
            bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
            cookieAuth: { type: 'apiKey', in: 'cookie', name: 'access_token' },
        },
    },
    paths: {
        '/api/v1/auth/register/options': {
            post: {
                tags: ['Auth'],
                summary: 'Begin passkey registration',
                description:
                    'Step 1 of the WebAuthn registration ceremony. Returns creation options + a single-use ' +
                    'challenge; pass them to the browser (navigator.credentials.create).',
                requestBody: { content: jsonContent(registerOptionsSchema) },
                responses: {
                    '200': {
                        description: 'PublicKeyCredentialCreationOptions',
                        content: jsonContent(success(z.object({}).loose())),
                    },
                    '400': { description: 'Invalid email', content: jsonContent(validationError) },
                },
            },
        },
        '/api/v1/auth/register/verify': {
            post: {
                tags: ['Auth'],
                summary: 'Finish passkey registration',
                description:
                    'Step 2 — verify the authenticator attestation against the challenge, create the account + ' +
                    'store the passkey, and set the session (access) token as an httpOnly cookie (also returned ' +
                    'in the body for non-browser clients).',
                requestBody: { content: jsonContent(registerVerifySchema) },
                responses: {
                    '201': {
                        description: 'Registered; session cookie set',
                        content: jsonContent(
                            success(
                                z.object({
                                    user: z.object({ id: z.uuid(), email: z.string(), role: z.string() }),
                                    token: z.string(),
                                }),
                            ),
                        ),
                    },
                    '400': {
                        description: 'Invalid body or the attestation could not be verified',
                        content: jsonContent(validationError),
                    },
                },
            },
        },
        '/api/v1/auth/login/options': {
            post: {
                tags: ['Auth'],
                summary: 'Begin passkey login (email optional / usernameless)',
                description:
                    'Step 1 of authentication. `email` is optional: with it, allowCredentials is seeded ' +
                    'for that account; without it, login is usernameless / discoverable (conditional UI / ' +
                    'passkey autofill). Sets a login_id cookie correlating the challenge; no enumeration.',
                requestBody: { content: jsonContent(loginOptionsSchema) },
                responses: {
                    '200': {
                        description: 'PublicKeyCredentialRequestOptions',
                        content: jsonContent(success(z.object({}).loose())),
                    },
                    '400': { description: 'Invalid email', content: jsonContent(validationError) },
                },
            },
        },
        '/api/v1/auth/login/verify': {
            post: {
                tags: ['Auth'],
                summary: 'Finish passkey login',
                description:
                    'Step 2 — body is just the assertion (no email). The user is resolved from the ' +
                    'passkey’s credential id; the challenge from the login_id cookie. Advances the sign ' +
                    'counter and sets the access + refresh cookies (also returned in the body).',
                requestBody: { content: jsonContent(loginVerifySchema) },
                responses: {
                    '200': {
                        description: 'Logged in; session cookie set',
                        content: jsonContent(
                            success(
                                z.object({
                                    user: z.object({ id: z.uuid(), email: z.string(), role: z.string() }),
                                    token: z.string(),
                                }),
                            ),
                        ),
                    },
                    '400': { description: 'Invalid body', content: jsonContent(validationError) },
                    '401': { description: 'Invalid credentials', content: jsonContent(errorEnvelope) },
                },
            },
        },
        '/api/v1/auth/refresh': {
            post: {
                tags: ['Auth'],
                summary: 'Refresh the session',
                description:
                    'Exchange the (httpOnly) refresh token for a new access token + a rotated refresh token. ' +
                    'Reusing an already-rotated token revokes the whole session family.',
                requestBody: { content: jsonContent(refreshBodySchema) },
                responses: {
                    '200': {
                        description: 'New tokens; cookies rotated',
                        content: jsonContent(
                            success(
                                z.object({
                                    user: z.object({ id: z.uuid(), email: z.string(), role: z.string() }),
                                    token: z.string(),
                                    refreshToken: z.string(),
                                }),
                            ),
                        ),
                    },
                    '401': {
                        description: 'Missing, expired, or reused refresh token',
                        content: jsonContent(errorEnvelope),
                    },
                },
            },
        },
        '/api/v1/auth/logout': {
            post: {
                tags: ['Auth'],
                summary: 'Log out',
                description: 'Revoke the refresh-token family and clear the auth cookies.',
                requestBody: { content: jsonContent(refreshBodySchema) },
                responses: { '204': { description: 'Logged out' } },
            },
        },
        '/api/v1/auth/recover': {
            post: {
                tags: ['Auth'],
                summary: 'Request an account-recovery code',
                description:
                    'For a user who lost all their passkeys. Emails a 6-digit code (hashed at rest, ' +
                    '10-min TTL, 5-attempt budget). Always returns 200 — never reveals whether the account exists.',
                requestBody: { content: jsonContent(recoverSchema) },
                responses: {
                    '200': { description: 'If the account exists, a code was sent', content: jsonContent(success()) },
                    '400': { description: 'Invalid email', content: jsonContent(validationError) },
                },
            },
        },
        '/api/v1/auth/recover/verify': {
            post: {
                tags: ['Auth'],
                summary: 'Verify a recovery code',
                description:
                    'Verify the 6-digit code. On success the code is consumed, a passkey-registration ' +
                    'ceremony starts (options returned), and a recovery_id cookie is set. A wrong code burns ' +
                    'one attempt; the code is invalidated once the budget is exhausted.',
                requestBody: { content: jsonContent(recoverVerifySchema) },
                responses: {
                    '200': {
                        description: 'Code accepted — passkey creation options',
                        content: jsonContent(success(z.object({}).loose())),
                    },
                    '400': { description: 'Invalid body', content: jsonContent(validationError) },
                    '401': { description: 'Invalid or expired code', content: jsonContent(errorEnvelope) },
                },
            },
        },
        '/api/v1/auth/recover/complete': {
            post: {
                tags: ['Auth'],
                summary: 'Finish recovery (register a new passkey)',
                description:
                    'Verify the new passkey against the recovery ceremony (recovery_id cookie), attach it to ' +
                    'the account, and log in (access + refresh). Recovery authorizes ONLY adding a passkey.',
                requestBody: { content: jsonContent(recoverCompleteSchema) },
                responses: {
                    '201': {
                        description: 'Recovered; new passkey registered and logged in',
                        content: jsonContent(
                            success(
                                z.object({
                                    user: z.object({ id: z.uuid(), email: z.string(), role: z.string() }),
                                    token: z.string(),
                                    refreshToken: z.string(),
                                }),
                            ),
                        ),
                    },
                    '400': { description: 'Invalid body or attestation', content: jsonContent(validationError) },
                    '401': { description: 'No/expired recovery in progress', content: jsonContent(errorEnvelope) },
                },
            },
        },
        '/api/v1/auth/credentials': {
            get: {
                tags: ['Auth'],
                summary: 'List my passkeys',
                description: 'The authenticated user’s registered passkeys (sanitized — no key material).',
                security: [{ bearerAuth: [] }, { cookieAuth: [] }],
                responses: {
                    '200': { description: 'Passkeys', content: jsonContent(success(z.array(credentialSchema))) },
                    '401': { description: 'Not authenticated', content: jsonContent(errorEnvelope) },
                },
            },
        },
        '/api/v1/auth/credentials/options': {
            post: {
                tags: ['Auth'],
                summary: 'Begin adding a passkey (logged-in)',
                description: 'Step 1 of registering an ADDITIONAL passkey on the authenticated account.',
                security: [{ bearerAuth: [] }, { cookieAuth: [] }],
                responses: {
                    '200': {
                        description: 'PublicKeyCredentialCreationOptions',
                        content: jsonContent(success(z.object({}).loose())),
                    },
                    '401': { description: 'Not authenticated', content: jsonContent(errorEnvelope) },
                },
            },
        },
        '/api/v1/auth/credentials/verify': {
            post: {
                tags: ['Auth'],
                summary: 'Finish adding a passkey (logged-in)',
                description: 'Step 2 — verify the attestation and attach the new passkey to the account.',
                security: [{ bearerAuth: [] }, { cookieAuth: [] }],
                requestBody: { content: jsonContent(addCredentialVerifySchema) },
                responses: {
                    '201': { description: 'Passkey added', content: jsonContent(success(credentialSchema)) },
                    '400': { description: 'Invalid body or attestation', content: jsonContent(validationError) },
                    '401': { description: 'Not authenticated', content: jsonContent(errorEnvelope) },
                },
            },
        },
        '/api/v1/auth/credentials/{id}': {
            delete: {
                tags: ['Auth'],
                summary: 'Remove a passkey',
                description: 'Delete one of your passkeys. Refused if it is your only one (would lock you out).',
                security: [{ bearerAuth: [] }, { cookieAuth: [] }],
                responses: {
                    '204': { description: 'Removed' },
                    '401': { description: 'Not authenticated', content: jsonContent(errorEnvelope) },
                    '404': { description: 'Passkey not found', content: jsonContent(errorEnvelope) },
                    '409': { description: 'Cannot remove your only passkey', content: jsonContent(errorEnvelope) },
                },
            },
        },
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
                    "resolved against this concert's tiers. Refused once any seat is sold or held. Admin only.",
                security: [{ bearerAuth: [] }, { cookieAuth: [] }],
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
                    '401': { description: 'Not authenticated', content: jsonContent(errorEnvelope) },
                    '403': { description: 'Not an admin', content: jsonContent(errorEnvelope) },
                    '404': { description: 'Concert not found', content: jsonContent(errorEnvelope) },
                    '409': {
                        description: 'Concert already has sold or held seats',
                        content: jsonContent(errorEnvelope),
                    },
                },
            },
        },
        '/api/v1/concerts/{id}/queue/join': {
            post: {
                tags: ['Queue'],
                summary: 'Join the waiting room for a concert',
                description:
                    'For a high-demand (gatedOnSale) concert, buyers must be admitted here before they can ' +
                    'hold seats. Returns `{ gated, admitted, position }`. An ungated concert returns admitted:true.',
                security: [{ bearerAuth: [] }, { cookieAuth: [] }],
                requestParams: { path: concertIdParamSchema },
                responses: {
                    '200': {
                        description: 'Queue state',
                        content: jsonContent(
                            success(z.object({ gated: z.boolean(), admitted: z.boolean(), position: z.int() })),
                        ),
                    },
                    '401': { description: 'Not authenticated', content: jsonContent(errorEnvelope) },
                    '404': { description: 'Concert not found', content: jsonContent(errorEnvelope) },
                },
            },
        },
        '/api/v1/concerts/{id}/queue/status': {
            get: {
                tags: ['Queue'],
                summary: 'Poll your queue position / admission',
                security: [{ bearerAuth: [] }, { cookieAuth: [] }],
                requestParams: { path: concertIdParamSchema },
                responses: {
                    '200': {
                        description: 'Queue state',
                        content: jsonContent(
                            success(z.object({ gated: z.boolean(), admitted: z.boolean(), position: z.int() })),
                        ),
                    },
                    '401': { description: 'Not authenticated', content: jsonContent(errorEnvelope) },
                    '404': { description: 'Concert not found', content: jsonContent(errorEnvelope) },
                },
            },
        },
        '/api/v1/concerts/{id}/queue/gating': {
            patch: {
                tags: ['Queue'],
                summary: 'Turn the waiting room on/off for a concert (admin)',
                description:
                    'Admin only. Sets `gatedOnSale`, which decides whether buyers must be admitted before holding seats.',
                security: [{ bearerAuth: [] }, { cookieAuth: [] }],
                requestParams: { path: concertIdParamSchema },
                requestBody: { content: jsonContent(gatingSchema) },
                responses: {
                    '200': {
                        description: 'Gating updated',
                        content: jsonContent(success(z.object({ gatedOnSale: z.boolean() }))),
                    },
                    '400': { description: 'Invalid body', content: jsonContent(validationError) },
                    '401': { description: 'Not authenticated', content: jsonContent(errorEnvelope) },
                    '403': { description: 'Not an admin', content: jsonContent(errorEnvelope) },
                    '404': { description: 'Concert not found', content: jsonContent(errorEnvelope) },
                },
            },
        },
        '/api/v1/reserves': {
            post: {
                tags: ['Reserves'],
                summary: 'Hold seats (5-minute exclusive hold)',
                description:
                    'Creates one Order + one PENDING reserve per seat, all-or-nothing. Seats are seat numbers only — ' +
                    "each seat's tier and price are derived server-side from the seat catalog. The holder is the " +
                    'authenticated user (from the session token) — no userId in the body. For a gatedOnSale concert, ' +
                    'the caller must first be admitted through the waiting-room queue.',
                security: [{ bearerAuth: [] }, { cookieAuth: [] }],
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
                    '401': { description: 'Not authenticated', content: jsonContent(errorEnvelope) },
                    '403': {
                        description: 'Gated concert — not yet admitted through the waiting room',
                        content: jsonContent(errorEnvelope),
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
                    'Only the order owner (from the session token) may pay. Payment gateway integration is Phase 6b.',
                security: [{ bearerAuth: [] }, { cookieAuth: [] }],
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
                    '401': { description: 'Not authenticated', content: jsonContent(errorEnvelope) },
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
