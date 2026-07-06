import { DataSource } from 'typeorm';
import { createTestDataSource } from '../helpers/testDataSource';
import { buildTestContainer } from '../helpers/testContainer';
import { seedBasic, seedUser } from '../helpers/seed';
import type { IReserveService } from '../../src/services/ReserveService';
import type { ITicketService } from '../../src/services/TicketService';
import { Ticket, TicketStatus } from '../../src/entities/Ticket';
import { Reserve, ReserveStatus } from '../../src/entities/Reserve';
import { Order, OrderStatus } from '../../src/entities/Order';
import { TicketTier } from '../../src/entities/TicketTier';

describe('Confirm order / payment (integration)', () => {
    let ds: DataSource;
    let reserveSvc: IReserveService;
    let ticketSvc: ITicketService;

    beforeEach(async () => {
        ds = createTestDataSource();
        await ds.initialize();
        const c = buildTestContainer(ds);
        reserveSvc = c.resolve<IReserveService>('IReserveService');
        ticketSvc = c.resolve<ITicketService>('ITicketService');
    });
    afterEach(async () => {
        await ds.destroy();
    });

    const hold = (userId: string, concertId: string, tierId: string, seats: string[]) =>
        reserveSvc.reserveTickets({ userId, concertId, seats: seats.map((seatNumber) => ({ tierId, seatNumber })) });
    const tierQty = async (tierId: string) => (await ds.getRepository(TicketTier).findOneByOrFail({ id: tierId })).quantity;

    it('confirms: SOLD tickets created, reserves CONFIRMED, tier decremented, totalAmount set', async () => {
        const { concertId, tierId, userId } = await seedBasic(ds); // tier qty 100, price 5000
        const { order } = await hold(userId, concertId, tierId, ['A1', 'A2']);

        const res = await ticketSvc.confirmOrder({ orderId: order.id, userId });

        expect(res.tickets).toHaveLength(2);
        expect(res.order.status).toBe(OrderStatus.CONFIRMED);
        expect(res.order.totalAmount).toBe(2 * 5000);
        expect(await ds.getRepository(Ticket).count({ where: { concert: { id: concertId }, status: TicketStatus.SOLD } })).toBe(2);
        expect(await tierQty(tierId)).toBe(100 - 2);
        expect(await ds.getRepository(Reserve).count({ where: { order: { id: order.id }, status: ReserveStatus.CONFIRMED } })).toBe(2);
    });

    it('rolls back entirely when a seat was sold out from under the order', async () => {
        const { concertId, tierId, userId } = await seedBasic(ds);
        const { order } = await hold(userId, concertId, tierId, ['X1']);
        // simulate another buyer taking X1
        await ds.getRepository(Ticket).save({
            seatNumber: 'X1', status: TicketStatus.SOLD, pricePaid: 5000,
            concert: { id: concertId }, ticketTier: { id: tierId }, user: { id: userId },
        } as Ticket);
        const qtyBefore = await tierQty(tierId);

        await expect(ticketSvc.confirmOrder({ orderId: order.id, userId }))
            .rejects.toMatchObject({ name: 'SeatsUnavailableError', reason: 'sold' });

        expect((await ds.getRepository(Order).findOneByOrFail({ id: order.id })).status).toBe(OrderStatus.PENDING);
        expect(await tierQty(tierId)).toBe(qtyBefore); // decrement rolled back
    });

    it('rejects double-confirm (order no longer pending)', async () => {
        const { concertId, tierId, userId } = await seedBasic(ds);
        const { order } = await hold(userId, concertId, tierId, ['A1']);
        await ticketSvc.confirmOrder({ orderId: order.id, userId });
        await expect(ticketSvc.confirmOrder({ orderId: order.id, userId }))
            .rejects.toMatchObject({ name: 'TicketUnavailableError' });
    });

    it('rejects an expired hold with ReserveExpiredError', async () => {
        const { concertId, tierId, userId } = await seedBasic(ds);
        const { order } = await hold(userId, concertId, tierId, ['A1']);
        await ds.getRepository(Reserve).update({ order: { id: order.id } }, { expiresAt: new Date(Date.now() - 1000) });
        await expect(ticketSvc.confirmOrder({ orderId: order.id, userId }))
            .rejects.toMatchObject({ name: 'ReserveExpiredError' });
    });

    it('NotFoundError for a missing order', async () => {
        const { userId } = await seedBasic(ds);
        await expect(ticketSvc.confirmOrder({ orderId: '00000000-0000-0000-0000-000000000000', userId }))
            .rejects.toMatchObject({ name: 'NotFoundError' });
    });

    it('TicketUnavailableError when the order belongs to a different user', async () => {
        const { concertId, tierId, userId } = await seedBasic(ds);
        const { order } = await hold(userId, concertId, tierId, ['A1']);
        const other = await seedUser(ds);
        await expect(ticketSvc.confirmOrder({ orderId: order.id, userId: other.id }))
            .rejects.toMatchObject({ name: 'TicketUnavailableError' });
    });
});
