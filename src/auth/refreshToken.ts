import { randomBytes, createHash } from 'crypto';
import { getRedisClient } from '../redis';
import { UnauthorizedError } from '../error';

/**
 * Refresh tokens with rotation + reuse-detection.
 *
 * A refresh token is `<familyId>.<secret>` — an opaque, high-entropy string. Redis (or an in-memory
 * map in tests) holds ONE record per family: the current token's SHA-256 hash + the owner. Each use
 * rotates the token (new secret, new hash). If an OLD, already-rotated token is presented, that's a
 * theft signal → the whole family is revoked (every session in it dies). Logout revokes the family.
 *
 * SHA-256 (not argon2) is deliberate: these tokens are 256-bit random, so there's nothing to
 * brute-force — a fast hash that keeps a Redis dump from being replayable is exactly right.
 */
const useRedis = process.env.NODE_ENV !== 'test' && !!process.env.REDIS_URL;
const REFRESH_TTL_SEC = Number(process.env.REFRESH_TTL_DAYS ?? 30) * 24 * 60 * 60;

interface FamilyRecord {
    userId: string;
    currentHash: string;
}

const memory = new Map<string, { record: FamilyRecord; expiresAt: number }>();
const familyKey = (familyId: string) => `refresh:family:${familyId}`;

const hash = (token: string): string => createHash('sha256').update(token).digest('hex');
const makeToken = (familyId: string): string => `${familyId}.${randomBytes(32).toString('base64url')}`;
const parseFamilyId = (token: string): string | null => {
    const dot = token.indexOf('.');
    return dot > 0 ? token.slice(0, dot) : null;
};

async function saveFamily(familyId: string, record: FamilyRecord): Promise<void> {
    if (useRedis) {
        await getRedisClient().set(familyKey(familyId), JSON.stringify(record), 'EX', REFRESH_TTL_SEC);
        return;
    }
    memory.set(familyId, { record, expiresAt: Date.now() + REFRESH_TTL_SEC * 1000 });
}

async function loadFamily(familyId: string): Promise<FamilyRecord | null> {
    if (useRedis) {
        const raw = await getRedisClient().get(familyKey(familyId));
        return raw ? (JSON.parse(raw) as FamilyRecord) : null;
    }
    const entry = memory.get(familyId);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
        memory.delete(familyId);
        return null;
    }
    return entry.record;
}

async function deleteFamily(familyId: string): Promise<void> {
    if (useRedis) {
        await getRedisClient().del(familyKey(familyId));
        return;
    }
    memory.delete(familyId);
}

/** Start a new session family and return its first refresh token. */
export async function issueRefreshToken(userId: string): Promise<string> {
    const familyId = randomBytes(16).toString('hex');
    const token = makeToken(familyId);
    await saveFamily(familyId, { userId, currentHash: hash(token) });
    return token;
}

/**
 * Rotate a refresh token: return a fresh one and the owner. Throws `UnauthorizedError` if the token
 * is malformed, expired, or a reuse of an already-rotated token — the last case ALSO revokes the
 * whole family.
 */
export async function rotateRefreshToken(token: string): Promise<{ userId: string; token: string }> {
    const familyId = parseFamilyId(token);
    if (!familyId) throw new UnauthorizedError('Invalid session.');
    const family = await loadFamily(familyId);
    if (!family) throw new UnauthorizedError('Session expired or revoked.');
    if (family.currentHash !== hash(token)) {
        // An old, already-rotated token was replayed → likely stolen → burn the whole family.
        await deleteFamily(familyId);
        throw new UnauthorizedError('Session revoked (token reuse detected).');
    }
    const next = makeToken(familyId);
    await saveFamily(familyId, { userId: family.userId, currentHash: hash(next) });
    return { userId: family.userId, token: next };
}

/** Revoke the family a token belongs to (logout). No-op for a malformed token. */
export async function revokeRefreshToken(token: string): Promise<void> {
    const familyId = parseFamilyId(token);
    if (familyId) await deleteFamily(familyId);
}
