import { join, status, release, isAdmitted } from '../../src/queue/queueStore';

// NODE_ENV=test → the in-memory backend. Each test uses a fresh concert id, so state is isolated.
describe('waiting-room queue store (in-memory)', () => {
    const CAP = 2;
    const TTL = 60_000;

    it('admits up to the cap, queues the rest with a 1-based position', async () => {
        const c = 'c-cap';
        expect((await join(c, 'u1', CAP, TTL)).admitted).toBe(true);
        expect((await join(c, 'u2', CAP, TTL)).admitted).toBe(true);
        const u3 = await join(c, 'u3', CAP, TTL);
        expect(u3.admitted).toBe(false);
        expect(u3.position).toBe(1);
        expect((await join(c, 'u4', CAP, TTL)).position).toBe(2);
    });

    it('join is idempotent — re-joining keeps your place', async () => {
        const c = 'c-idem';
        await join(c, 'a', CAP, TTL);
        await join(c, 'b', CAP, TTL);
        const first = await join(c, 'x', CAP, TTL);
        const again = await join(c, 'x', CAP, TTL);
        expect(again.position).toBe(first.position);
    });

    it('releasing an active slot lets the next waiter in on their next poll', async () => {
        const c = 'c-rel';
        await join(c, 'u1', CAP, TTL);
        await join(c, 'u2', CAP, TTL);
        expect((await join(c, 'u3', CAP, TTL)).admitted).toBe(false);
        await release(c, 'u1');
        expect((await status(c, 'u3', CAP, TTL)).admitted).toBe(true);
        expect(await isAdmitted(c, 'u3')).toBe(true);
    });

    it('an expired pass frees the slot', async () => {
        const c = 'c-exp';
        expect((await join(c, 'u1', 1, 50)).admitted).toBe(true);
        expect((await join(c, 'u2', 1, 50)).admitted).toBe(false);
        await new Promise((r) => setTimeout(r, 80));
        expect((await status(c, 'u2', 1, 50)).admitted).toBe(true);
    });
});
