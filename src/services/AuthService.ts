import { injectable, inject } from 'tsyringe';
import { QueryFailedError } from 'typeorm';
import { randomBytes } from 'crypto';
import type {
    PublicKeyCredentialCreationOptionsJSON,
    RegistrationResponseJSON,
    PublicKeyCredentialRequestOptionsJSON,
    AuthenticationResponseJSON,
} from '@simplewebauthn/server';
import { IUserRepository } from '../repositories/UserRepository';
import { ICredentialRepository } from '../repositories/CredentialRepository';
import {
    buildRegistrationOptions,
    verifyRegistration,
    buildAuthenticationOptions,
    verifyAuthentication,
} from '../auth/webauthn';
import { setChallenge, takeChallenge } from '../auth/challengeStore';
import { signAccessToken } from '../auth/jwt';
import { issueRefreshToken, rotateRefreshToken, revokeRefreshToken } from '../auth/refreshToken';
import { resolveRole } from '../auth/roles';
import { BadRequestError, UnauthorizedError, NotFoundError, ConflictError } from '../error';
import { User } from '../entities/User';
import { Credential } from '../entities/Credential';

const regChallengeKey = (email: string) => `webauthn:reg:${email}`;
// Login challenges are keyed by an opaque per-attempt loginId (carried in a cookie), NOT the email —
// this is what lets login be usernameless / discoverable.
const loginChallengeKey = (loginId: string) => `webauthn:login:${loginId}`;
const addCredChallengeKey = (userId: string) => `webauthn:addcred:${userId}`;

/** Login options + the opaque loginId that correlates this attempt's challenge (set as a cookie). */
export interface LoginOptions {
    options: PublicKeyCredentialRequestOptionsJSON;
    loginId: string;
}

/** A completed authentication: the user, a short-lived access token, and a rotating refresh token. */
export interface AuthResult {
    user: User;
    token: string;
    refreshToken: string;
}

export interface IAuthService {
    beginRegistration(email: string): Promise<PublicKeyCredentialCreationOptionsJSON>;
    finishRegistration(email: string, response: RegistrationResponseJSON): Promise<AuthResult>;
    beginLogin(email?: string): Promise<LoginOptions>;
    finishLogin(loginId: string, response: AuthenticationResponseJSON): Promise<AuthResult>;
    refreshSession(refreshToken: string): Promise<AuthResult>;
    logout(refreshToken: string): Promise<void>;
    // Multi-device passkey management (all for an already-authenticated user).
    beginAddCredential(userId: string): Promise<PublicKeyCredentialCreationOptionsJSON>;
    finishAddCredential(userId: string, response: RegistrationResponseJSON, nickname?: string): Promise<Credential>;
    listCredentials(userId: string): Promise<Credential[]>;
    removeCredential(userId: string, credentialRowId: string): Promise<void>;
}

/**
 * Passkey (WebAuthn) auth. Registration is a two-step ceremony:
 *  1. beginRegistration → issue creation options + a single-use challenge (stored in Redis/memory).
 *  2. finishRegistration → verify the attestation against that challenge, create the account +
 *     store the public-key credential, and mint the session (access) token.
 * There is no password to hash — the private key never leaves the user's authenticator.
 */
@injectable()
export class AuthService implements IAuthService {
    constructor(
        @inject('IUserRepository') private userRepository: IUserRepository,
        @inject('ICredentialRepository') private credentialRepository: ICredentialRepository,
    ) {}

    async beginRegistration(email: string): Promise<PublicKeyCredentialCreationOptionsJSON> {
        const normalized = email.toLowerCase();
        const existing = await this.userRepository.findByEmail(normalized);
        // If the account exists, exclude its passkeys so the authenticator won't re-register a dupe.
        const excludeCredentialIds = existing
            ? (await this.credentialRepository.findByUserId(existing.id)).map((c) => c.credentialId)
            : [];
        const options = await buildRegistrationOptions({ email: normalized, excludeCredentialIds });
        await setChallenge(regChallengeKey(normalized), options.challenge);
        return options;
    }

    async finishRegistration(email: string, response: RegistrationResponseJSON): Promise<AuthResult> {
        const normalized = email.toLowerCase();
        const expectedChallenge = await takeChallenge(regChallengeKey(normalized));
        if (!expectedChallenge) {
            throw new BadRequestError('No pending registration for this email — start the ceremony again.');
        }

        let verified;
        try {
            verified = await verifyRegistration({ response, expectedChallenge });
        } catch {
            throw new BadRequestError('Passkey registration could not be verified.');
        }

        // find-or-create the account for this email, then attach the new passkey to it. The role is
        // resolved from the ADMIN_EMAILS allowlist and refreshed if the account already existed.
        const role = resolveRole(normalized);
        let user = await this.userRepository.findByEmail(normalized);
        if (!user) {
            user = await this.userRepository.createUser({ email: normalized, role });
        } else if (user.role !== role) {
            await this.userRepository.updateRole(user.id, role);
            user.role = role;
        }
        try {
            await this.credentialRepository.create({
                userId: user.id,
                credentialId: verified.credentialId,
                publicKey: verified.publicKey,
                counter: verified.counter,
                transports: verified.transports,
                deviceType: verified.deviceType,
                backedUp: verified.backedUp,
                aaguid: verified.aaguid,
            });
        } catch (err) {
            if (err instanceof QueryFailedError && /unique/i.test(err.message)) {
                throw new BadRequestError('This passkey is already registered.');
            }
            throw err;
        }

        const token = signAccessToken({ sub: user.id, role });
        const refreshToken = await issueRefreshToken(user.id);
        return { user, token, refreshToken };
    }

    /**
     * Begin login. With an email, `allowCredentials` is seeded from that account's passkeys (a hint);
     * without one, the allow-list is empty → usernameless / discoverable login (conditional UI). Either
     * way the challenge is stored under a fresh loginId, returned for the caller to set as a cookie.
     * An unknown email is indistinguishable from usernameless (no account enumeration).
     */
    async beginLogin(email?: string): Promise<LoginOptions> {
        let allowCredentialIds: string[] = [];
        if (email) {
            const user = await this.userRepository.findByEmail(email.toLowerCase());
            if (user) {
                allowCredentialIds = (await this.credentialRepository.findByUserId(user.id)).map((c) => c.credentialId);
            }
        }
        const options = await buildAuthenticationOptions({ allowCredentialIds });
        const loginId = randomBytes(16).toString('hex');
        await setChallenge(loginChallengeKey(loginId), options.challenge);
        return { options, loginId };
    }

    /**
     * Finish login. The user is resolved FROM the passkey (`response.id` → credential → owner), so no
     * email is needed — the same path serves both typed-email and usernameless login. Generic errors
     * throughout so nothing leaks about which step failed.
     */
    async finishLogin(loginId: string, response: AuthenticationResponseJSON): Promise<AuthResult> {
        const expectedChallenge = await takeChallenge(loginChallengeKey(loginId));
        if (!expectedChallenge) throw new UnauthorizedError('Invalid credentials.');

        const credential = await this.credentialRepository.findByCredentialId(response.id);
        if (!credential || !credential.user) throw new UnauthorizedError('Invalid credentials.');
        const user = credential.user;

        let result;
        try {
            result = await verifyAuthentication({
                response,
                expectedChallenge,
                credential: {
                    credentialId: credential.credentialId,
                    publicKey: credential.publicKey,
                    counter: credential.counter,
                    transports: credential.transports,
                },
            });
        } catch {
            throw new UnauthorizedError('Invalid credentials.');
        }

        // Persist the advanced sign counter (clone detection). Never rolls backward for a genuine key.
        await this.credentialRepository.updateCounter(credential.credentialId, result.newCounter);

        // Refresh the role from the allowlist so promote/demote takes effect on this login.
        const role = resolveRole(user.email);
        if (user.role !== role) {
            await this.userRepository.updateRole(user.id, role);
            user.role = role;
        }

        const token = signAccessToken({ sub: user.id, role });
        const refreshToken = await issueRefreshToken(user.id);
        return { user, token, refreshToken };
    }

    /**
     * Exchange a refresh token for a new access token + a rotated refresh token. The role is
     * re-resolved from the allowlist so promote/demote propagates on refresh, not just on login.
     * A reused (already-rotated) token throws and revokes the whole family (see rotateRefreshToken).
     */
    async refreshSession(refreshToken: string): Promise<AuthResult> {
        const rotated = await rotateRefreshToken(refreshToken);
        const user = await this.userRepository.findById(rotated.userId);
        if (!user) throw new UnauthorizedError('Session no longer valid.');
        const role = resolveRole(user.email);
        if (user.role !== role) {
            await this.userRepository.updateRole(user.id, role);
            user.role = role;
        }
        const token = signAccessToken({ sub: user.id, role });
        return { user, token, refreshToken: rotated.token };
    }

    async logout(refreshToken: string): Promise<void> {
        await revokeRefreshToken(refreshToken);
    }

    // --- Multi-device passkey management (caller is already authenticated: userId from the token) ---

    async beginAddCredential(userId: string): Promise<PublicKeyCredentialCreationOptionsJSON> {
        const user = await this.userRepository.findById(userId);
        if (!user) throw new NotFoundError('User not found');
        const existing = await this.credentialRepository.findByUserId(userId);
        const options = await buildRegistrationOptions({
            email: user.email,
            excludeCredentialIds: existing.map((c) => c.credentialId),
        });
        await setChallenge(addCredChallengeKey(userId), options.challenge);
        return options;
    }

    async finishAddCredential(
        userId: string,
        response: RegistrationResponseJSON,
        nickname?: string,
    ): Promise<Credential> {
        const expectedChallenge = await takeChallenge(addCredChallengeKey(userId));
        if (!expectedChallenge) throw new BadRequestError('No pending passkey registration — start again.');

        let verified;
        try {
            verified = await verifyRegistration({ response, expectedChallenge });
        } catch {
            throw new BadRequestError('Passkey could not be verified.');
        }

        try {
            return await this.credentialRepository.create({
                userId,
                credentialId: verified.credentialId,
                publicKey: verified.publicKey,
                counter: verified.counter,
                transports: verified.transports,
                deviceType: verified.deviceType,
                backedUp: verified.backedUp,
                aaguid: verified.aaguid,
                nickname,
            });
        } catch (err) {
            if (err instanceof QueryFailedError && /unique/i.test(err.message)) {
                throw new BadRequestError('This passkey is already registered.');
            }
            throw err;
        }
    }

    async listCredentials(userId: string): Promise<Credential[]> {
        return this.credentialRepository.findByUserId(userId);
    }

    async removeCredential(userId: string, credentialRowId: string): Promise<void> {
        // Guard against lockout: never let a user delete their only passkey.
        const creds = await this.credentialRepository.findByUserId(userId);
        if (creds.length <= 1) {
            throw new ConflictError('You cannot remove your only passkey — add another first.');
        }
        const affected = await this.credentialRepository.deleteByIdForUser(credentialRowId, userId);
        if (affected === 0) throw new NotFoundError('Passkey not found');
    }
}
