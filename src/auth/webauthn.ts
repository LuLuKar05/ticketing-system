import { generateRegistrationOptions, verifyRegistrationResponse } from '@simplewebauthn/server';
import type { PublicKeyCredentialCreationOptionsJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
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
