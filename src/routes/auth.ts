import { Router, json, RequestHandler } from 'express';
import { IAuthController } from '../controllers/AuthController';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/requireAuth';
import {
    registerOptionsSchema,
    registerVerifySchema,
    loginOptionsSchema,
    loginVerifySchema,
    addCredentialVerifySchema,
    credentialIdParamSchema,
    refreshBodySchema,
} from '../dtos/auth.dto';

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
    router.post('/auth/login/options', rateLimiter, smallBody, validate(loginOptionsSchema), (req, res) =>
        authController.loginOptions(req, res),
    );
    router.post('/auth/login/verify', rateLimiter, smallBody, validate(loginVerifySchema), (req, res) =>
        authController.loginVerify(req, res),
    );

    // Session lifecycle — the refresh token itself is the credential (cookie or body), so no requireAuth.
    router.post('/auth/refresh', rateLimiter, smallBody, validate(refreshBodySchema), (req, res) =>
        authController.refresh(req, res),
    );
    router.post('/auth/logout', rateLimiter, smallBody, validate(refreshBodySchema), (req, res) =>
        authController.logout(req, res),
    );

    // Multi-device passkey management — all require an authenticated session.
    router.post('/auth/credentials/options', rateLimiter, requireAuth, (req, res) =>
        authController.addCredentialOptions(req, res),
    );
    router.post(
        '/auth/credentials/verify',
        rateLimiter,
        requireAuth,
        smallBody,
        validate(addCredentialVerifySchema),
        (req, res) => authController.addCredentialVerify(req, res),
    );
    router.get('/auth/credentials', requireAuth, (req, res) => authController.listCredentials(req, res));
    router.delete('/auth/credentials/:id', requireAuth, validate(credentialIdParamSchema, 'params'), (req, res) =>
        authController.removeCredential(req, res),
    );
    return router;
}
