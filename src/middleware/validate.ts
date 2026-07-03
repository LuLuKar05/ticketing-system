import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';

/**
 * Generic validation middleware factory. Parses the chosen request part against a
 * zod schema; on success it replaces it with the parsed (typed/coerced) data, on
 * failure it forwards the ZodError to the central error handler (→ 400).
 *
 * Usage:  router.post('/reserves', validate(reserveSchema), handler)
 */
export const validate =
    (schema: ZodSchema, source: 'body' | 'params' | 'query' = 'body') =>
    (req: Request, _res: Response, next: NextFunction) => {
        const result = schema.safeParse(req[source]);
        if (!result.success) return next(result.error);
        // req.body is safely reassignable; params/query are getters in Express 5,
        // so only replace body. For params/query we validate but leave as-is.
        if (source === 'body') req.body = result.data;
        next();
    };
