import { Request, Response } from 'express';
import { injectable, inject } from 'tsyringe';
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from '@simplewebauthn/server';
import { IAuthService, AuthResult } from '../services/AuthService';
import {
    RegisterOptionsDTO,
    RegisterVerifyDTO,
    LoginOptionsDTO,
    LoginVerifyDTO,
    AddCredentialVerifyDTO,
    RecoverDTO,
    RecoverVerifyDTO,
    RecoverCompleteDTO,
} from '../dtos/auth.dto';
import {
    setSessionCookie,
    setRefreshCookie,
    clearSessionCookie,
    clearRefreshCookie,
    setLoginChallengeCookie,
    clearLoginChallengeCookie,
    setRecoveryCookie,
    clearRecoveryCookie,
    REFRESH_COOKIE_NAME,
    LOGIN_CHALLENGE_COOKIE_NAME,
    RECOVERY_COOKIE_NAME,
} from '../auth/cookie';
import { toCredential } from '../dtos/response.dto';
import { UnauthorizedError } from '../error';

export interface IAuthController {
    registerOptions(req: Request, res: Response): Promise<void>;
    registerVerify(req: Request, res: Response): Promise<void>;
    loginOptions(req: Request, res: Response): Promise<void>;
    loginVerify(req: Request, res: Response): Promise<void>;
    refresh(req: Request, res: Response): Promise<void>;
    logout(req: Request, res: Response): Promise<void>;
    recover(req: Request, res: Response): Promise<void>;
    recoverVerify(req: Request, res: Response): Promise<void>;
    recoverComplete(req: Request, res: Response): Promise<void>;
    addCredentialOptions(req: Request, res: Response): Promise<void>;
    addCredentialVerify(req: Request, res: Response): Promise<void>;
    listCredentials(req: Request, res: Response): Promise<void>;
    removeCredential(req: Request, res: Response): Promise<void>;
}

@injectable()
export class AuthController implements IAuthController {
    constructor(@inject('IAuthService') private authService: IAuthService) {}

    async registerOptions(req: Request, res: Response): Promise<void> {
        const { email } = req.body as RegisterOptionsDTO;
        const options = await this.authService.beginRegistration(email);
        res.status(200).json({ status: 'success', message: 'Registration options', data: options });
    }

    // Set the access + refresh cookies (browsers) AND return both tokens in the body (other clients).
    private sendAuth(res: Response, status: number, message: string, result: AuthResult): void {
        setSessionCookie(res, result.token);
        setRefreshCookie(res, result.refreshToken);
        res.status(status).json({
            status: 'success',
            message,
            data: {
                user: { id: result.user.id, email: result.user.email, role: result.user.role },
                token: result.token,
                refreshToken: result.refreshToken,
            },
        });
    }

    private readRefreshToken(req: Request): string | null {
        const cookies = req.cookies as Record<string, string> | undefined;
        const fromBody = (req.body as { refreshToken?: string } | undefined)?.refreshToken;
        return cookies?.[REFRESH_COOKIE_NAME] ?? fromBody ?? null;
    }

    async registerVerify(req: Request, res: Response): Promise<void> {
        const { email, response } = req.body as RegisterVerifyDTO;
        const result = await this.authService.finishRegistration(
            email,
            response as unknown as RegistrationResponseJSON,
        );
        this.sendAuth(res, 201, 'Registered', result);
    }

    async loginOptions(req: Request, res: Response): Promise<void> {
        const { email } = req.body as LoginOptionsDTO;
        const { options, loginId } = await this.authService.beginLogin(email);
        // The loginId cookie correlates this attempt's challenge (works with or without an email).
        setLoginChallengeCookie(res, loginId);
        res.status(200).json({ status: 'success', message: 'Login options', data: options });
    }

    async loginVerify(req: Request, res: Response): Promise<void> {
        const { response } = req.body as LoginVerifyDTO;
        const cookies = req.cookies as Record<string, string> | undefined;
        const loginId = cookies?.[LOGIN_CHALLENGE_COOKIE_NAME];
        if (!loginId) throw new UnauthorizedError('No pending login — start again.');
        const result = await this.authService.finishLogin(loginId, response as unknown as AuthenticationResponseJSON);
        clearLoginChallengeCookie(res);
        this.sendAuth(res, 200, 'Logged in', result);
    }

    async refresh(req: Request, res: Response): Promise<void> {
        const token = this.readRefreshToken(req);
        if (!token) throw new UnauthorizedError('No refresh token provided.');
        const result = await this.authService.refreshSession(token);
        this.sendAuth(res, 200, 'Session refreshed', result);
    }

    async logout(req: Request, res: Response): Promise<void> {
        const token = this.readRefreshToken(req);
        if (token) await this.authService.logout(token);
        clearSessionCookie(res);
        clearRefreshCookie(res);
        res.status(204).send();
    }

    async recover(req: Request, res: Response): Promise<void> {
        const { email } = req.body as RecoverDTO;
        await this.authService.beginRecovery(email);
        // Always the same response — never reveal whether the account exists.
        res.status(200).json({ status: 'success', message: 'If that account exists, a recovery code was sent.' });
    }

    async recoverVerify(req: Request, res: Response): Promise<void> {
        const { email, code } = req.body as RecoverVerifyDTO;
        const { options, recoveryId } = await this.authService.verifyRecoveryCode(email, code);
        setRecoveryCookie(res, recoveryId);
        res.status(200).json({ status: 'success', message: 'Code accepted — register a new passkey', data: options });
    }

    async recoverComplete(req: Request, res: Response): Promise<void> {
        const { response } = req.body as RecoverCompleteDTO;
        const cookies = req.cookies as Record<string, string> | undefined;
        const recoveryId = cookies?.[RECOVERY_COOKIE_NAME];
        if (!recoveryId) throw new UnauthorizedError('No recovery in progress — start again.');
        const result = await this.authService.completeRecovery(
            recoveryId,
            response as unknown as RegistrationResponseJSON,
        );
        clearRecoveryCookie(res);
        this.sendAuth(res, 201, 'Recovered — new passkey registered', result);
    }

    // --- Multi-device passkey management (all behind requireAuth: userId from req.user) ---

    async addCredentialOptions(req: Request, res: Response): Promise<void> {
        const userId = req.user?.id;
        if (!userId) throw new UnauthorizedError();
        const options = await this.authService.beginAddCredential(userId);
        res.status(200).json({ status: 'success', message: 'Add-passkey options', data: options });
    }

    async addCredentialVerify(req: Request, res: Response): Promise<void> {
        const userId = req.user?.id;
        if (!userId) throw new UnauthorizedError();
        const { response, nickname } = req.body as AddCredentialVerifyDTO;
        const credential = await this.authService.finishAddCredential(
            userId,
            response as unknown as RegistrationResponseJSON,
            nickname,
        );
        res.status(201).json({ status: 'success', message: 'Passkey added', data: toCredential(credential) });
    }

    async listCredentials(req: Request, res: Response): Promise<void> {
        const userId = req.user?.id;
        if (!userId) throw new UnauthorizedError();
        const credentials = await this.authService.listCredentials(userId);
        res.status(200).json({ status: 'success', message: 'Passkeys', data: credentials.map(toCredential) });
    }

    async removeCredential(req: Request, res: Response): Promise<void> {
        const userId = req.user?.id;
        if (!userId) throw new UnauthorizedError();
        const { id } = req.params as { id: string };
        await this.authService.removeCredential(userId, id);
        res.status(204).send();
    }
}
