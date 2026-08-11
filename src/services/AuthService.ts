import { injectable, inject } from 'tsyringe';
import { QueryFailedError } from 'typeorm';
import type { PublicKeyCredentialCreationOptionsJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { IUserRepository } from '../repositories/UserRepository';
import { ICredentialRepository } from '../repositories/CredentialRepository';
import { buildRegistrationOptions, verifyRegistration } from '../auth/webauthn';
import { setChallenge, takeChallenge } from '../auth/challengeStore';
import { signAccessToken } from '../auth/jwt';
import { BadRequestError } from '../error';
import { User } from '../entities/User';

const regChallengeKey = (email: string) => `webauthn:reg:${email}`;

export interface IAuthService {
    beginRegistration(email: string): Promise<PublicKeyCredentialCreationOptionsJSON>;
    finishRegistration(email: string, response: RegistrationResponseJSON): Promise<{ user: User; token: string }>;
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

    async finishRegistration(
        email: string,
        response: RegistrationResponseJSON,
    ): Promise<{ user: User; token: string }> {
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

        // find-or-create the account for this email, then attach the new passkey to it.
        const user =
            (await this.userRepository.findByEmail(normalized)) ??
            (await this.userRepository.createUser({ email: normalized }));
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

        const token = signAccessToken({ sub: user.id, role: user.role });
        return { user, token };
    }
}
