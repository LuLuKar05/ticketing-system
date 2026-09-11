import { QueueService } from '../../src/services/QueueService';

/**
 * Uses the REAL in-memory queue store (NODE_ENV=test) with a mocked concert repo + event bus, so the
 * assertions are about what the service *publishes* as the line moves.
 */
describe('QueueService — live position push', () => {
    let concertRepo: any;
    let eventBus: any;
    let service: QueueService;

    const events = () => eventBus.publishQueueEvent.mock.calls.map((c: any[]) => c[0]);

    beforeEach(() => {
        process.env.QUEUE_ACTIVE_LIMIT = '1'; // one slot, so the 2nd+ joiner waits
        concertRepo = { findConcertById: jest.fn().mockResolvedValue({ id: 'c1', gatedOnSale: true }) };
        eventBus = { publishQueueEvent: jest.fn(), publishSeatEvent: jest.fn() };
        service = new QueueService(concertRepo, eventBus);
    });

    afterEach(() => {
        delete process.env.QUEUE_ACTIVE_LIMIT;
    });

    it('an ungated concert short-circuits — no queue, no events', async () => {
        concertRepo.findConcertById.mockResolvedValue({ id: 'c0', gatedOnSale: false });
        const res = await service.join('c0', 'u1');
        expect(res).toEqual({ gated: false, admitted: true, position: 0 });
        expect(eventBus.publishQueueEvent).not.toHaveBeenCalled();
    });

    it('publishes queue:admitted for the user it lets through', async () => {
        const cid = 'c-admit';
        const res = await service.join(cid, 'u1');
        expect(res.admitted).toBe(true);
        expect(events()).toContainEqual({ type: 'queue:admitted', concertId: cid, userId: 'u1' });
    });

    it('pushes each waiter their new position when the line moves', async () => {
        const cid = 'c-pos';
        await service.join(cid, 'u1'); // takes the only slot
        await service.join(cid, 'u2'); // waits at 1
        const third = await service.join(cid, 'u3'); // waits at 2
        expect(third.admitted).toBe(false);
        expect(third.position).toBe(2);

        eventBus.publishQueueEvent.mockClear();
        await service.release(cid, 'u1'); // slot frees…
        await service.status(cid, 'u2'); // …a poll promotes u2

        // u2 got in, and u3 was told it moved up to the front of the line.
        expect(events()).toContainEqual({ type: 'queue:admitted', concertId: cid, userId: 'u2' });
        expect(events()).toContainEqual({ type: 'queue:position', concertId: cid, userId: 'u3', position: 1 });
    });

    it('leaving the line moves everyone behind you up', async () => {
        const cid = 'c-leave-pos';
        await service.join(cid, 'u1'); // admitted
        await service.join(cid, 'u2'); // position 1
        await service.join(cid, 'u3'); // position 2

        eventBus.publishQueueEvent.mockClear();
        await service.leave(cid, 'u2');
        expect(events()).toContainEqual({ type: 'queue:position', concertId: cid, userId: 'u3', position: 1 });
    });
});
