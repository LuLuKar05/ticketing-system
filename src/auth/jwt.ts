import jwt from 'jsonwebtoken';
import { generateKeyPairSync } from 'crypto';
import { logger } from '../observability/logger';

/**
 * Session access token — an RS256-signed JWT.
 *
 * RS256 (asymmetric) is deliberate: we sign with a private key and anyone can verify with the
 * public key. Today the issuer and verifier are the same app, but this keeps the door open to a
 * future where an external IdP issues tokens and this API verifies them against a JWKS — the
 * `verifyAccessToken` path already checks `issuer` + `audience`, exactly as an IdP token would need.
 */
interface KeyPair {
    privateKey: string;
    publicKey: string;
}

let keys: KeyPair | null = null;

function getKeys(): KeyPair {
    if (keys) return keys;
    const priv = process.env.JWT_PRIVATE_KEY;
    const pub = process.env.JWT_PUBLIC_KEY;
    if (priv && pub) {
        // Allow single-line env PEMs with literal "\n" escapes.
        keys = { privateKey: priv.replace(/\\n/g, '\n'), publicKey: pub.replace(/\\n/g, '\n') };
        return keys;
    }
    if (process.env.NODE_ENV === 'production') {
        throw new Error('JWT_PRIVATE_KEY and JWT_PUBLIC_KEY (RS256 PEM) are required in production.');
    }
    // Dev/test: ephemeral keypair so the app runs with zero setup. Tokens don't survive a restart.
    const generated = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    logger.warn('JWT_PRIVATE_KEY/JWT_PUBLIC_KEY not set — using an ephemeral RS256 keypair (dev only).');
    keys = { privateKey: generated.privateKey, publicKey: generated.publicKey };
    return keys;
}

const ISSUER = process.env.JWT_ISSUER ?? 'ticketing-api';
const AUDIENCE = process.env.JWT_AUDIENCE ?? 'ticketing-clients';
const ACCESS_TTL = process.env.JWT_ACCESS_TTL ?? '15m';

export interface AccessTokenClaims {
    sub: string; // user id
    role: string;
}

export function signAccessToken(claims: AccessTokenClaims): string {
    const options: jwt.SignOptions = {
        algorithm: 'RS256',
        subject: claims.sub,
        issuer: ISSUER,
        audience: AUDIENCE,
        expiresIn: ACCESS_TTL as jwt.SignOptions['expiresIn'],
    };
    return jwt.sign({ role: claims.role }, getKeys().privateKey, options);
}

/** Verify signature + issuer + audience + expiry. Throws (jwt errors) if invalid. */
export function verifyAccessToken(token: string): AccessTokenClaims {
    const decoded = jwt.verify(token, getKeys().publicKey, {
        algorithms: ['RS256'],
        issuer: ISSUER,
        audience: AUDIENCE,
    }) as jwt.JwtPayload;
    return { sub: decoded.sub as string, role: (decoded.role as string) ?? 'customer' };
}
