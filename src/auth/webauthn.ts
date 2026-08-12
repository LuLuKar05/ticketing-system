import {
    generateRegistrationOptions,
    verifyRegistrationResponse,
    generateAuthenticationOptions,
    verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
    PublicKeyCredentialCreationOptionsJSON,
    RegistrationResponseJSON,
    PublicKeyCredentialRequestOptionsJSON,
    AuthenticationResponseJSON,
    AuthenticatorTransportFuture,
} from '@simplewebauthn/server';
import { randomBytes } from 'crypto';

/**
 * Thin wrappers around @simplewebauthn/server so the service layer never touches the WebAuthn
 * primitives directly. WebAuthn is tightly bound to a domain (RP ID) and origin — these come from
 * env so dev (localhost) and prod (real HTTPS domain) differ only by configuration.
 */
const RP_ID = process.env.RP_ID ?? 'localhost';
const RP_NAME = process.env.RP_NAME ?? 'Concert Ticketing';
const RP_ORIGIN = process.env.RP_ORIGIN ?? 'http://localhost:5000';

/** What we persist to the `credential` table after a verified registration. */
export interface VerifiedCredential {
    credentialId: string;
    publicKey: string; // base64url (public — not hashed)
    counter: number;
    transports?: string[];
    deviceType: string;
    backedUp: boolean;
    aaguid: string;
}

export async function buildRegistrationOptions(params: {
    email: string;
    excludeCredentialIds?: string[];
}): Promise<PublicKeyCredentialCreationOptionsJSON> {
    return generateRegistrationOptions({
        rpName: RP_NAME,
        rpID: RP_ID,
        userName: params.email,
        userDisplayName: params.email,
        // Random user handle — we map a returned assertion back to a user by credential id, not by
        // this handle, so it need not be stable or stored.
        userID: new Uint8Array(randomBytes(32)),
        attestationType: 'none', // consumer passkeys: privacy-preserving, no device-model attestation
        excludeCredentials: (params.excludeCredentialIds ?? []).map((id) => ({ id })),
        authenticatorSelection: {
            residentKey: 'preferred', // allow discoverable (usernameless) login later
            userVerification: 'preferred',
        },
    });
}

export async function verifyRegistration(params: {
    response: RegistrationResponseJSON;
    expectedChallenge: string;
}): Promise<VerifiedCredential> {
    const verification = await verifyRegistrationResponse({
        response: params.response,
        expectedChallenge: params.expectedChallenge,
        expectedOrigin: RP_ORIGIN,
        expectedRPID: RP_ID,
        requireUserVerification: false,
    });
    if (!verification.verified || !verification.registrationInfo) {
        throw new Error('Passkey registration could not be verified');
    }
    const { credential, credentialDeviceType, credentialBackedUp, aaguid } = verification.registrationInfo;
    return {
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey).toString('base64url'),
        counter: credential.counter,
        transports: credential.transports,
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
        aaguid,
    };
}

/** A stored passkey, as needed to verify a login assertion. */
export interface StoredCredential {
    credentialId: string;
    publicKey: string; // base64url
    counter: number;
    transports?: string[];
}

export async function buildAuthenticationOptions(params: {
    allowCredentialIds?: string[];
}): Promise<PublicKeyCredentialRequestOptionsJSON> {
    return generateAuthenticationOptions({
        rpID: RP_ID,
        // Empty = let the authenticator offer any passkey for this RP (also the shape we return for
        // an unknown email, so login never reveals whether an account exists).
        allowCredentials: (params.allowCredentialIds ?? []).map((id) => ({ id })),
        userVerification: 'preferred',
    });
}

export async function verifyAuthentication(params: {
    response: AuthenticationResponseJSON;
    expectedChallenge: string;
    credential: StoredCredential;
}): Promise<{ newCounter: number }> {
    const verification = await verifyAuthenticationResponse({
        response: params.response,
        expectedChallenge: params.expectedChallenge,
        expectedOrigin: RP_ORIGIN,
        expectedRPID: RP_ID,
        credential: {
            id: params.credential.credentialId,
            publicKey: new Uint8Array(Buffer.from(params.credential.publicKey, 'base64url')),
            counter: params.credential.counter,
            transports: params.credential.transports as AuthenticatorTransportFuture[] | undefined,
        },
        requireUserVerification: false,
    });
    if (!verification.verified) throw new Error('Passkey authentication could not be verified');
    return { newCounter: verification.authenticationInfo.newCounter };
}
