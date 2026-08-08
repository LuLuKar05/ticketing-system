import { DataSource } from 'typeorm';
import { createTestDataSource } from '../helpers/testDataSource';
import { buildTestContainer } from '../helpers/testContainer';
import { seedBasic, seedUser } from '../helpers/seed';
import type { IReserveService } from '../../src/services/ReserveService';
import type { ITicketService } from '../../src/services/TicketService';
import type { ISeatService } from '../../src/services/SeatService';
import { Ticket, TicketStatus } from '../../src/entities/Ticket';
import { Reserve, ReserveStatus } from '../../src/entities/Reserve';
import { Order, OrderStatus } from '../../src/entities/Order';
import { Concert, ConcertStatus } from '../../src/entities/Concert';

describe('Confirm order / payment (integration)', () => {
    let ds: DataSource;
    let reserveSvc: IReserveService;
    let ticketSvc: ITicketService;
    let seatSvc: ISeatService;

    beforeEach(async () => {
        ds = createTestDataSource();
        await ds.initialize();
        const c = buildTestContainer(ds);
        reserveSvc = c.resolve<IReserveService>('IReserveService');
        ticketSvc = c.resolve<ITicketService>('ITicketService');
        seatSvc = c.resolve<ISeatService>('ISeatService');
    });
    afterEach(async () => {
        await ds.destroy();
    });

    const hold = (userId: string, concertId: string, tierId: string, seats: string[]) =>
        reserveSvc.reserveTickets({ userId, concertId, seats });

    it('confirms: SOLD tickets created, reserves CONFIRMED, totalAmount set', async () => {
        const { concertId, tierId, userId } = await seedBasic(ds); // price 5000
        const { order } = await hold(userId, concertId, tierId, ['A1', 'A2']);

        const res = await ticketSvc.confirmOrder({ orderId: order.id, userId });

        expect(res.tickets).toHaveLength(2);
        expect(res.order.status).toBe(OrderStatus.CONFIRMED);
        expect(res.order.totalAmount).toBe(2 * 5000);
        expect(
            await ds.getRepository(Ticket).count({ where: { concert: { id: concertId }, status: TicketStatus.SOLD } }),
        ).toBe(2);
        expect(
            await ds
                .getRepository(Reserve)
                .count({ where: { order: { id: order.id }, status: ReserveStatus.CONFIRMED } }),
        ).toBe(2);
    });

    it('lets a user hold again once they have PAID for their previous order (one-active-hold clears)', async () => {
        const { concertId, tierId, userId } = await seedBasic(ds);
        const { order } = await hold(userId, concertId, tierId, ['A1']);
        // a second hold while the first is pending is blocked…
        await expect(hold(userId, concertId, tierId, ['A2'])).rejects.toMatchObject({ name: 'ConflictError' });
        // …but after paying (reserves → CONFIRMED), the user may hold again
        await ticketSvc.confirmOrder({ orderId: order.id, userId });
        const { order: order2 } = await hold(userId, concertId, tierId, ['A2']);
        expect(order2.id).toBeDefined();
    });

    it('rolls back entirely when a seat was sold out from under the order', async () => {
        const { concertId, tierId, userId } = await seedBasic(ds);
        const { order } = await hold(userId, concertId, tierId, ['A1']);
        // simulate another buyer taking A1
        await ds.getRepository(Ticket).save({
            seatNumber: 'A1',
            status: TicketStatus.SOLD,
            pricePaid: 5000,
            concert: { id: concertId },
            ticketTier: { id: tierId },
            user: { id: userId },
        } as Ticket);

        await expect(ticketSvc.confirmOrder({ orderId: order.id, userId })).rejects.toMatchObject({
            name: 'SeatsUnavailableError',
            reason: 'sold',
        });

        expect((await ds.getRepository(Order).findOneByOrFail({ id: order.id })).status).toBe(OrderStatus.PENDING);
    });

    // §7 — confirm is idempotent (keyed on orderId): a retried/duplicated confirm returns the same
    // tickets rather than erroring or charging twice, so a client retry after a network blip is safe.
    it('is idempotent: a repeat confirm returns the same tickets, never double-charges', async () => {
        const { concertId, tierId, userId } = await seedBasic(ds);
        const { order } = await hold(userId, concertId, tierId, ['A1', 'A2']);
        const first = await ticketSvc.confirmOrder({ orderId: order.id, userId });
        const second = await ticketSvc.confirmOrder({ orderId: order.id, userId });

        // Same result, not an error — the replay hands back exactly the tickets the sale produced.
        expect(second.order.status).toBe(OrderStatus.CONFIRMED);
        expect(second.tickets.map((t) => t.id).sort()).toEqual(first.tickets.map((t) => t.id).sort());
        // No extra tickets created by the second call.
        expect(
            await ds.getRepository(Ticket).count({ where: { concert: { id: concertId }, status: TicketStatus.SOLD } }),
        ).toBe(2);
    });

    it('rejects an expired hold with ReserveExpiredError', async () => {
        const { concertId, tierId, userId } = await seedBasic(ds);
        const { order } = await hold(userId, concertId, tierId, ['A1']);
        await ds.getRepository(Reserve).update({ order: { id: order.id } }, { expiresAt: new Date(Date.now() - 1000) });
        await expect(ticketSvc.confirmOrder({ orderId: order.id, userId })).rejects.toMatchObject({
            name: 'ReserveExpiredError',
        });
    });

    it('NotFoundError for a missing order', async () => {
        const { userId } = await seedBasic(ds);
        await expect(
            ticketSvc.confirmOrder({ orderId: '00000000-0000-0000-0000-000000000000', userId }),
        ).rejects.toMatchObject({ name: 'NotFoundError' });
    });

    it('TicketUnavailableError when the order belongs to a different user', async () => {
        const { concertId, tierId, userId } = await seedBasic(ds);
        const { order } = await hold(userId, concertId, tierId, ['A1']);
        const other = await seedUser(ds);
        await expect(ticketSvc.confirmOrder({ orderId: order.id, userId: other.id })).rejects.toMatchObject({
            name: 'TicketUnavailableError',
        });
    });

    // §3.1 — a concert cancelled while an order sits PENDING must block payment.
    it('rejects confirm when the concert was cancelled after the hold', async () => {
        const { concertId, tierId, userId } = await seedBasic(ds);
        const { order } = await hold(userId, concertId, tierId, ['A1']);
        await ds.getRepository(Concert).update({ id: concertId }, { status: ConcertStatus.CANCELLED });

        await expect(ticketSvc.confirmOrder({ orderId: order.id, userId })).rejects.toMatchObject({
            name: 'ConcertNotSellableError',
        });
        // nothing committed — order stays PENDING, no tickets created
        expect((await ds.getRepository(Order).findOneByOrFail({ id: order.id })).status).toBe(OrderStatus.PENDING);
        expect(await ds.getRepository(Ticket).count({ where: { concert: { id: concertId } } })).toBe(0);
    });

    // §3.3 — resale: with the partial sold-unique index, a REFUNDED ticket no longer pins the seat.
    it('resale: a refunded seat frees up and can be sold again', async () => {
        const { concertId, tierId, userId } = await seedBasic(ds);

        // 1. Sell A1.
        const { order } = await hold(userId, concertId, tierId, ['A1']);
        const first = await ticketSvc.confirmOrder({ orderId: order.id, userId });
        const soldTicketId = first.tickets[0].id;

        // 2. Refund it → the seat map must report A1 available again (not sold).
        await ticketSvc.refundTicket({ userId, ticketId: soldTicketId, ticketTierId: tierId });
        const mapAfterRefund = await seatSvc.getSeatMapWithStatus(concertId);
        expect(mapAfterRefund.seats.find((s) => s.seatNumber === 'A1')?.status).toBe('available');

        // 3. Re-hold + re-confirm A1 — previously this exploded with 409 'sold'.
        const { order: order2 } = await hold(userId, concertId, tierId, ['A1']);
        const second = await ticketSvc.confirmOrder({ orderId: order2.id, userId });
        expect(second.tickets).toHaveLength(1);
        expect(second.tickets[0].seatNumber).toBe('A1');

        // A sold row and a refunded row now coexist for A1 (partial index allows it).
        expect(await ds.getRepository(Ticket).count({ where: { concert: { id: concertId }, seatNumber: 'A1' } })).toBe(
            2,
        );
        expect(
            await ds
                .getRepository(Ticket)
                .count({ where: { concert: { id: concertId }, seatNumber: 'A1', status: TicketStatus.SOLD } }),
        ).toBe(1);
    });
});
