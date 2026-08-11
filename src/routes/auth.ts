import { Router, json, RequestHandler } from 'express';
import { IAuthController } from '../controllers/AuthController';
import { validate } from '../middleware/validate';
import { registerOptionsSchema, registerVerifySchema } from '../dtos/auth.dto';

// The attestation payload is small; reject anything oversized at parse time (OWASP API4).
const smallBody = json({ limit: '16kb' });

export function createAuthRouter(authController: IAuthController, rateLimiter: RequestHandler) {
    const router = Router();
    // rateLimiter FIRST — auth endpoints are a prime brute-force / enumeration target.
    router.post('/auth/register/options', rateLimiter, smallBody, validate(registerOptionsSchema), (req, res) =>
        authController.registerOptions(req, res),
    );
    router.post('/auth/register/verify', rateLimiter, smallBody, validate(registerVerifySchema), (req, res) =>
        authController.registerVerify(req, res),
    );
    return router;
}
