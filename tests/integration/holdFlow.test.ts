import { DataSource } from 'typeorm';
import { createTestDataSource } from '../helpers/testDataSource';
import { buildTestContainer } from '../helpers/testContainer';
import { seedBasic } from '../helpers/seed';
import type { IReserveService } from '../../src/services/ReserveService';
import { Reserve, ReserveStatus } from '../../src/entities/Reserve';
import { Ticket, TicketStatus } from '../../src/entities/Ticket';

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
            userId, concertId, seats: [{ tierId, seatNumber: 'A1' }, { tierId, seatNumber: 'A2' }],
        });
        expect(order.id).toBeDefined();
        expect(await pendingCount(concertId)).toBe(2);
    });

    it('rejects re-holding an already-HELD seat (SeatsUnavailableError held), all-or-nothing', async () => {
        const { concertId, tierId, userId } = await seedBasic(ds);
        await reserveSvc.reserveTickets({ userId, concertId, seats: [{ tierId, seatNumber: 'A1' }] });
        await expect(
            reserveSvc.reserveTickets({ userId, concertId, seats: [{ tierId, seatNumber: 'A2' }, { tierId, seatNumber: 'A1' }] }),
        ).rejects.toMatchObject({ name: 'SeatsUnavailableError', reason: 'held' });
        // all-or-nothing: A2 must NOT have been created
        expect(await pendingCount(concertId)).toBe(1);
    });

    it('rejects holding a SOLD seat (SeatsUnavailableError sold)', async () => {
        const { concertId, tierId, userId } = await seedBasic(ds);
        await markSeatSold(concertId, tierId, userId, 'A1');
        await expect(
            reserveSvc.reserveTickets({ userId, concertId, seats: [{ tierId, seatNumber: 'A1' }] }),
        ).rejects.toMatchObject({ name: 'SeatsUnavailableError', reason: 'sold', seatNumbers: ['A1'] });
    });

    it('throws NotFoundError for a missing concert', async () => {
        const { tierId, userId } = await seedBasic(ds);
        await expect(
            reserveSvc.reserveTickets({ userId, concertId: '00000000-0000-0000-0000-000000000000', seats: [{ tierId, seatNumber: 'A1' }] }),
        ).rejects.toMatchObject({ name: 'NotFoundError' });
    });

    describe('oneTicketPerUser', () => {
        it('rejects an order of >1 seat', async () => {
            const { concertId, tierId, userId } = await seedBasic(ds, { oneTicketPerUser: true });
            await expect(
                reserveSvc.reserveTickets({ userId, concertId, seats: [{ tierId, seatNumber: 'A1' }, { tierId, seatNumber: 'A2' }] }),
            ).rejects.toMatchObject({ name: 'UserAlreadyHasTicketError' });
        });

        it('rejects when the user already OWNS a sold ticket for the concert', async () => {
            const { concertId, tierId, userId } = await seedBasic(ds, { oneTicketPerUser: true });
            await markSeatSold(concertId, tierId, userId, 'A1');
            await expect(
                reserveSvc.reserveTickets({ userId, concertId, seats: [{ tierId, seatNumber: 'A2' }] }),
            ).rejects.toMatchObject({ name: 'UserAlreadyHasTicketError' });
        });

        it('allows a single seat when the user owns none', async () => {
            const { concertId, tierId, userId } = await seedBasic(ds, { oneTicketPerUser: true });
            const { order } = await reserveSvc.reserveTickets({ userId, concertId, seats: [{ tierId, seatNumber: 'A1' }] });
            expect(order.id).toBeDefined();
            expect(await pendingCount(concertId)).toBe(1);
        });
    });
});
