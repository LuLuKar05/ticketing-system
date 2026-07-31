import { DataSource } from 'typeorm';
import { createTestDataSource } from '../helpers/testDataSource';
import { buildTestContainer } from '../helpers/testContainer';
import { seedBasic } from '../helpers/seed';
import type { IReserveService } from '../../src/services/ReserveService';
import { Reserve, ReserveStatus } from '../../src/entities/Reserve';
import { Ticket, TicketStatus } from '../../src/entities/Ticket';
import { ConcertStatus } from '../../src/entities/Concert';

describe('Hold flow (integration, real in-memory DB)', () => {
    let ds: DataSource;
    let reserveSvc: IReserveService;

    beforeEach(async () => {
        ds = createTestDataSource();
        await ds.initialize();
        reserveSvc = buildTestContainer(ds).resolve<IReserveService>('IReserveService');
    });
    afterEach(async () => {
        await ds.destroy();
    });

    const pendingCount = (concertId: string) =>
        ds.getRepository(Reserve).count({ where: { concert: { id: concertId }, status: ReserveStatus.PENDING } });

    async function markSeatSold(concertId: string, tierId: string, userId: string, seatNumber: string) {
        await ds.getRepository(Ticket).save({
            seatNumber, status: TicketStatus.SOLD, pricePaid: 5000,
            concert: { id: concertId }, ticketTier: { id: tierId }, user: { id: userId },
        } as Ticket);
    }

    it('holds multiple seats → one Order + N PENDING reserves', async () => {
        const { concertId, tierId, userId } = await seedBasic(ds);
        const { order } = await reserveSvc.reserveTickets({
            userId, concertId, seats: ['A1', 'A2'],
        });
        expect(order.id).toBeDefined();
        expect(await pendingCount(concertId)).toBe(2);
    });

    it('rejects re-holding an already-HELD seat (SeatsUnavailableError held), all-or-nothing', async () => {
        const { concertId, tierId, userId } = await seedBasic(ds);
        await reserveSvc.reserveTickets({ userId, concertId, seats: ['A1'] });
        await expect(
            reserveSvc.reserveTickets({ userId, concertId, seats: ['A2', 'A1'] }),
        ).rejects.toMatchObject({ name: 'SeatsUnavailableError', reason: 'held' });
        // all-or-nothing: A2 must NOT have been created
        expect(await pendingCount(concertId)).toBe(1);
    });

    it('an expired hold no longer blocks a fresh hold on the same seat (§3.2)', async () => {
        const { concertId, tierId, userId } = await seedBasic(ds);
        const { order } = await reserveSvc.reserveTickets({ userId, concertId, seats: ['A1'] });
        // force the hold to be expired-but-unswept
        await ds.getRepository(Reserve).update({ order: { id: order.id } }, { expiresAt: new Date(Date.now() - 1000) });

        // a fresh hold on A1 succeeds — the stale hold is reaped inside the hold transaction
        const { order: order2 } = await reserveSvc.reserveTickets({ userId, concertId, seats: ['A1'] });
        expect(order2.id).toBeDefined();
        // only the new hold is PENDING; the expired one was cancelled
        expect(await pendingCount(concertId)).toBe(1);
    });

    it('rejects holding a SOLD seat (SeatsUnavailableError sold)', async () => {
        const { concertId, tierId, userId } = await seedBasic(ds);
        await markSeatSold(concertId, tierId, userId, 'A1');
        await expect(
            reserveSvc.reserveTickets({ userId, concertId, seats: ['A1'] }),
        ).rejects.toMatchObject({ name: 'SeatsUnavailableError', reason: 'sold', seatNumbers: ['A1'] });
    });

    it('rejects a hold on a cancelled concert (ConcertNotSellableError) (§3.1)', async () => {
        const { concertId, userId } = await seedBasic(ds, { status: ConcertStatus.CANCELLED });
        await expect(
            reserveSvc.reserveTickets({ userId, concertId, seats: ['A1'] }),
        ).rejects.toMatchObject({ name: 'ConcertNotSellableError' });
    });

    it('rejects a hold on a past-dated concert (§3.1)', async () => {
        const { concertId, userId } = await seedBasic(ds, { concertDate: new Date(Date.now() - 1000) });
        await expect(
            reserveSvc.reserveTickets({ userId, concertId, seats: ['A1'] }),
        ).rejects.toMatchObject({ name: 'ConcertNotSellableError' });
    });

    it('throws NotFoundError for a missing concert', async () => {
        const { tierId, userId } = await seedBasic(ds);
        await expect(
            reserveSvc.reserveTickets({ userId, concertId: '00000000-0000-0000-0000-000000000000', seats: ['A1'] }),
        ).rejects.toMatchObject({ name: 'NotFoundError' });
    });

    describe('oneTicketPerUser', () => {
        it('rejects an order of >1 seat', async () => {
            const { concertId, tierId, userId } = await seedBasic(ds, { oneTicketPerUser: true });
            await expect(
                reserveSvc.reserveTickets({ userId, concertId, seats: ['A1', 'A2'] }),
            ).rejects.toMatchObject({ name: 'UserAlreadyHasTicketError' });
        });

        it('rejects when the user already OWNS a sold ticket for the concert', async () => {
            const { concertId, tierId, userId } = await seedBasic(ds, { oneTicketPerUser: true });
            await markSeatSold(concertId, tierId, userId, 'A1');
            await expect(
                reserveSvc.reserveTickets({ userId, concertId, seats: ['A2'] }),
            ).rejects.toMatchObject({ name: 'UserAlreadyHasTicketError' });
        });

        it('allows a single seat when the user owns none', async () => {
            const { concertId, tierId, userId } = await seedBasic(ds, { oneTicketPerUser: true });
            const { order } = await reserveSvc.reserveTickets({ userId, concertId, seats: ['A1'] });
            expect(order.id).toBeDefined();
            expect(await pendingCount(concertId)).toBe(1);
        });
    });
});
