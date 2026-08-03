import { Request, Response, NextFunction } from 'express';
import { logger } from '../observability/logger';

/**
 * Logs one line when a request arrives and one when it finishes (status + duration). Both inherit
 * the correlation id from the async-local store, so a request's whole lifecycle — receive →
 * (validation/handler) → error/complete — is traceable by a single `correlation_id`.
 * Mounted after correlationId (so the id is set) and before body parsing.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
    const start = Date.now();
    logger.info({ method: req.method, url: req.originalUrl }, 'request received');
    res.on('finish', () => {
        logger.info(
            { method: req.method, url: req.originalUrl, status: res.statusCode, durationMs: Date.now() - start },
            'request completed',
        );
    });
    next();
}
