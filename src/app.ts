import express from 'express';
import { Request, Response, NextFunction } from 'express'; //This is for the error-handling middleware
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import { ZodError } from 'zod';
import { openApiDoc } from './docs/openapi';
import { correlationId } from './middleware/correlationId';
import { requestLogger } from './middleware/requestLogger';
import { buildRateLimiter } from './middleware/rateLimit';
import { AppError, SeatsUnavailableError } from './error';
import { getCorrelationId } from './observability/requestContext';
import { logger } from './observability/logger';
import { createConcertRouter } from './routes/concerts';
import { createReserveRouter } from './routes/reserve';
import { createOrderRouter } from './routes/order';
import { createSeatRouter } from './routes/seat';
import { createAuthRouter } from './routes/auth';
import { IReserveController } from './controllers/ReserveController';
import { IConcertController } from './controllers/ConcertController';
import { IOrderController } from './controllers/OrderController';
import { ISeatController } from './controllers/SeatController';
import { IAuthController } from './controllers/AuthController';

export function createApp({
    concertController,
    reserveController,
    orderController,
    seatController,
    authController,
}: {
    concertController: IConcertController;
    reserveController: IReserveController;
    orderController: IOrderController;
    seatController: ISeatController;
    authController?: IAuthController;
}) {
    const app = express();
    // FIRST: stamp every request with a correlation id + bind it to the async-local store,
    // so even a body-parser failure below is traceable.
    app.use(correlationId);
    // Secure-by-default HTTP headers (OWASP API8 — security misconfiguration), incl. a STRICT
    // Content-Security-Policy by default — so any HTML this service ever serves (e.g. a future
    // frontend) is XSS-protected out of the box. The one page that needs a looser policy (Swagger
    // UI, which uses inline scripts) gets a SCOPED exception on its own route below — we relax the
    // control for that page only, never globally.
    app.use(helmet());
    // Parse cookies so requireAuth can read the httpOnly session cookie (unsigned — the JWT is
    // self-verifying via its signature, so no cookie secret is needed).
    app.use(cookieParser());
    // Log request receive/complete (correlation id auto-attached).
    app.use(requestLogger);
    // NOTE: body parsing is per-route (in each router) so every endpoint sets its OWN size limit
    // (OWASP API4). Tiny endpoints reject oversized bodies at parse time instead of after.

    //Liveness probe — used by the Docker HEALTHCHECK / orchestrators. Process-level only
    //(no DB round-trip): if this responds, the event loop is alive and Express is serving.
    app.get('/health', (_req: Request, res: Response) => {
        res.status(200).json({ status: 'ok', uptime: process.uptime() });
    });

    // Auth endpoints (passkey register/login). Rate-limited — a prime brute-force target.
    if (authController) {
        app.use('/api/v1', createAuthRouter(authController, buildRateLimiter({ keyPrefix: 'auth' })));
    }

    app.use('/api/v1', createConcertRouter(concertController));
    // Limiters built here (not module-level) so each createApp() — i.e. each test — gets isolated
    // counters, and each write endpoint gets its own key namespace (independent limits).
    app.use('/api/v1', createReserveRouter(reserveController, buildRateLimiter({ keyPrefix: 'reserve' })));
    app.use('/api/v1', createOrderRouter(orderController, buildRateLimiter({ keyPrefix: 'confirm' })));
    app.use('/api/v1', createSeatRouter(seatController, buildRateLimiter({ keyPrefix: 'seat-import' })));

    //API docs — Swagger UI + the raw spec (generated from the zod DTOs in src/docs/openapi.ts,
    //so request docs can never drift from what validate() actually enforces).
    //Scoped CSP exception: Swagger UI needs inline script/style; relax ONLY on this route (the
    //global strict CSP set by helmet() still applies to every other page/response).
    const swaggerCsp = helmet.contentSecurityPolicy({
        directives: {
            'default-src': ["'self'"],
            'script-src': ["'self'", "'unsafe-inline'"],
            'style-src': ["'self'", "'unsafe-inline'"],
            'img-src': ["'self'", 'data:'],
        },
    });
    app.use('/api/v1/docs', swaggerCsp, swaggerUi.serve, swaggerUi.setup(openApiDoc));
    app.get('/api/v1/openapi.json', (_req: Request, res: Response) => {
        res.json(openApiDoc);
    });

    //404 - Not Found Middleware
    app.use((_req: Request, res: Response) => {
        res.status(404).json({ error: 'NOT_FOUND', message: 'Resource not found', ref: getCorrelationId() });
    });

    //Error handling middleware — maps domain/validation errors to a uniform JSON shape
    //`{ error: CODE, message, ref }` and logs stack + correlation id on the way out.
    app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
        const ref = getCorrelationId();

        // Zod validation failure (from the validate() middleware) -> 400 with the issues attached.
        if (error instanceof ZodError) {
            logger.warn({ err: error, ref }, 'validation failed');
            res.status(400).json({
                error: 'VALIDATION_ERROR',
                message: 'Validation failed',
                details: error.issues,
                ref,
            });
            return;
        }
        // Malformed JSON body — express.json() throws a body-parser SyntaxError tagged
        // `type: 'entity.parse.failed'`. A client mistake is a 400, not a 500.
        if (error instanceof SyntaxError && (error as { type?: string }).type === 'entity.parse.failed') {
            logger.warn({ err: error, ref }, 'malformed JSON body');
            res.status(400).json({ error: 'MALFORMED_JSON', message: 'Malformed JSON in request body', ref });
            return;
        }
        // Body exceeded the per-route size limit (OWASP API4) — body-parser throws
        // `type: 'entity.too.large'` -> 413, not a 500.
        if ((error as { type?: string }).type === 'entity.too.large') {
            logger.warn({ err: error, ref }, 'request body too large');
            res.status(413).json({ error: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large', ref });
            return;
        }
        // Every domain error carries its own code + statusCode → one branch for all of them.
        if (error instanceof AppError) {
            logger.warn({ err: error, ref, code: error.code, statusCode: error.statusCode }, 'request failed');
            const body: Record<string, unknown> = { error: error.code, message: error.message, ref };
            if (error instanceof SeatsUnavailableError) {
                body.seatNumbers = error.seatNumbers;
                body.reason = error.reason;
            }
            res.status(error.statusCode).json(body);
            return;
        }
        // Anything unmapped is a real bug → 500, full stack logged.
        logger.error({ err: error, ref }, 'unhandled error');
        res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Internal server error', ref });
    });
    return app;
}
