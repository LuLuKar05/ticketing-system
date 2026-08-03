import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { runWithContext } from '../observability/requestContext';

const HEADER = 'X-Correlation-ID';

/**
 * First middleware in the chain: give every request a correlation id.
 * - Reuse a caller-supplied `X-Correlation-ID` (lets a client/gateway trace across services),
 *   otherwise mint a UUID (Node's built-in crypto.randomUUID — no dependency).
 * - Echo it back on the response header so the caller can log/correlate.
 * - Bind it to the async-local store so every downstream log carries it automatically.
 */
export function correlationId(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header(HEADER)?.trim();
    const id = incoming && incoming.length > 0 ? incoming : randomUUID();
    res.setHeader(HEADER, id);
    runWithContext({ correlationId: id }, () => next());
}
