import { getRedisClient } from '../redis';

/**
 * Short-lived store for a pending account-recovery code. Redis when available, in-memory otherwise
 * (tests / no REDIS_URL), mirroring the challenge + refresh stores. The 6-digit code is stored
 * HASHED (bcrypt) with a small attempt budget — see AuthService.verifyRecoveryCode.
 */
const useRedis = process.env.NODE_ENV !== 'test' && !!process.env.REDIS_URL;
const CODE_TTL_SEC = 10 * 60; // 10 minutes to enter the code

export interface RecoveryRecord {
    codeHash: string;
    userId: string;
    attemptsLeft: number;
}

const memory = new Map<string, { rec: RecoveryRecord; expiresAt: number }>();
const key = (email: string) => `recovery:code:${email}`;

export async function setRecovery(email: string, rec: RecoveryRecord): Promise<void> {
    if (useRedis) {
        await getRedisClient().set(key(email), JSON.stringify(rec), 'EX', CODE_TTL_SEC);
        return;
    }
    memory.set(email, { rec, expiresAt: Date.now() + CODE_TTL_SEC * 1000 });
}

export async function getRecovery(email: string): Promise<RecoveryRecord | null> {
    if (useRedis) {
        const raw = await getRedisClient().get(key(email));
        return raw ? (JSON.parse(raw) as RecoveryRecord) : null;
    }
    const entry = memory.get(email);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
        memory.delete(email);
        return null;
    }
    return entry.rec;
}

export async function deleteRecovery(email: string): Promise<void> {
    if (useRedis) {
        await getRedisClient().del(key(email));
        return;
    }
    memory.delete(email);
}
