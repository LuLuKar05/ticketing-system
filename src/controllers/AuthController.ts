import { Request, Response } from 'express';
import { injectable, inject } from 'tsyringe';
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from '@simplewebauthn/server';
import { IAuthService } from '../services/AuthService';
import {
    RegisterOptionsDTO,
    RegisterVerifyDTO,
    LoginOptionsDTO,
    LoginVerifyDTO,
    AddCredentialVerifyDTO,
} from '../dtos/auth.dto';
import { setSessionCookie } from '../auth/cookie';
import { toCredential } from '../dtos/response.dto';
import { UnauthorizedError } from '../error';

export interface IAuthController {
    registerOptions(req: Request, res: Response): Promise<void>;
    registerVerify(req: Request, res: Response): Promise<void>;
    loginOptions(req: Request, res: Response): Promise<void>;
    loginVerify(req: Request, res: Response): Promise<void>;
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

    async registerVerify(req: Request, res: Response): Promise<void> {
        const { email, response } = req.body as RegisterVerifyDTO;
        const { user, token } = await this.authService.finishRegistration(
            email,
            response as unknown as RegistrationResponseJSON,
        );
        // Set the session cookie for browsers AND return the token in the body for other clients.
        setSessionCookie(res, token);
        res.status(201).json({
            status: 'success',
            message: 'Registered',
            data: { user: { id: user.id, email: user.email, role: user.role }, token },
        });
    }

    async loginOptions(req: Request, res: Response): Promise<void> {
        const { email } = req.body as LoginOptionsDTO;
        const options = await this.authService.beginLogin(email);
        res.status(200).json({ status: 'success', message: 'Login options', data: options });
    }

    async loginVerify(req: Request, res: Response): Promise<void> {
        const { email, response } = req.body as LoginVerifyDTO;
        const { user, token } = await this.authService.finishLogin(
            email,
            response as unknown as AuthenticationResponseJSON,
        );
        setSessionCookie(res, token);
        res.status(200).json({
            status: 'success',
            message: 'Logged in',
            data: { user: { id: user.id, email: user.email, role: user.role }, token },
        });
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
