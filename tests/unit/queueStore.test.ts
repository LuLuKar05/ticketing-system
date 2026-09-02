import { join, status, release, leave, isAdmitted } from '../../src/queue/queueStore';

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

    it('reports the userIds it promoted (for the "you’re in" push)', async () => {
        const c = 'c-prom';
        expect((await join(c, 'u1', CAP, TTL)).promoted).toContain('u1');
        await join(c, 'u2', CAP, TTL);
        await join(c, 'u3', CAP, TTL); // waits (cap 2)
        await release(c, 'u1');
        expect((await status(c, 'u3', CAP, TTL)).promoted).toContain('u3');
    });

    it('an expired pass frees the slot', async () => {
        const c = 'c-exp';
        expect((await join(c, 'u1', 1, 50)).admitted).toBe(true);
        expect((await join(c, 'u2', 1, 50)).admitted).toBe(false);
        await new Promise((r) => setTimeout(r, 80));
        expect((await status(c, 'u2', 1, 50)).admitted).toBe(true);
    });

    it('leave: a waiter drops out and the next person moves up', async () => {
        const c = 'c-leave';
        await join(c, 'u1', CAP, TTL);
        await join(c, 'u2', CAP, TTL); // cap full
        await join(c, 'u3', CAP, TTL); // position 1
        await join(c, 'u4', CAP, TTL); // position 2
        await leave(c, 'u3');
        expect((await status(c, 'u4', CAP, TTL)).position).toBe(1); // u4 advanced
    });

    it('leave: an admitted user gives up their slot → the next waiter is promoted', async () => {
        const c = 'c-leave2';
        await join(c, 'u1', CAP, TTL);
        await join(c, 'u2', CAP, TTL);
        expect((await join(c, 'u3', CAP, TTL)).admitted).toBe(false);
        await leave(c, 'u1');
        expect((await status(c, 'u3', CAP, TTL)).admitted).toBe(true);
    });

    it('never admits beyond the cap, even with many simultaneous joins', async () => {
        const c = 'c-stress';
        const results = await Promise.all(Array.from({ length: 20 }, (_, i) => join(c, `u${i}`, CAP, TTL)));
        expect(results.filter((r) => r.admitted).length).toBe(CAP);
        expect(await isAdmitted(c, 'u0')).toBe(true);
    });
});
