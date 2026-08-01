import { DataSource } from 'typeorm';
import { createTestDataSource } from '../helpers/testDataSource';
import { buildTestContainer } from '../helpers/testContainer';
import { seedBasic } from '../helpers/seed';
import type { IReserveService } from '../../src/services/ReserveService';
import type { ISweeperService } from '../../src/services/SweeperService';
import { Reserve, ReserveStatus } from '../../src/entities/Reserve';
import { Order, OrderStatus } from '../../src/entities/Order';

describe('Expiry sweeper (integration)', () => {
    let ds: DataSource;
    let reserveSvc: IReserveService;
    let sweeper: ISweeperService;

    beforeEach(async () => {
        ds = createTestDataSource();
        await ds.initialize();
        const c = buildTestContainer(ds);
        reserveSvc = c.resolve<IReserveService>('IReserveService');
        sweeper = c.resolve<ISweeperService>('ISweeperService');
    });
    afterEach(async () => {
        await ds.destroy();
    });

    const expire = (orderId: string) =>
        ds.getRepository(Reserve).update({ order: { id: orderId } }, { expiresAt: new Date(Date.now() - 1000) });

    it('cancels expired holds + their stale order, and frees the seat', async () => {
        const { concertId, userId } = await seedBasic(ds);
        const { order } = await reserveSvc.reserveTickets({ userId, concertId, seats: ['S1'] });
        await expire(order.id);

        const result = await sweeper.sweepOnce();
        expect(result.reserves).toBe(1);
        expect(result.orders).toBe(1);

        expect((await ds.getRepository(Reserve).findOneOrFail({ where: { order: { id: order.id } } })).status).toBe(
            ReserveStatus.CANCELLED,
        );
        expect((await ds.getRepository(Order).findOneByOrFail({ id: order.id })).status).toBe(OrderStatus.CANCELLED);

        // seat is re-holdable now
        const again = await reserveSvc.reserveTickets({ userId, concertId, seats: ['S1'] });
        expect(again.order.id).toBeDefined();
    });

    it('leaves fresh (unexpired) holds untouched', async () => {
        const { concertId, userId } = await seedBasic(ds);
        const { order } = await reserveSvc.reserveTickets({ userId, concertId, seats: ['S2'] });

        const result = await sweeper.sweepOnce();
        expect(result.reserves).toBe(0);

        expect((await ds.getRepository(Reserve).findOneOrFail({ where: { order: { id: order.id } } })).status).toBe(
            ReserveStatus.PENDING,
        );
        expect((await ds.getRepository(Order).findOneByOrFail({ id: order.id })).status).toBe(OrderStatus.PENDING);
    });
});
