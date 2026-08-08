import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestDataSource } from '../helpers/testDataSource';
import { buildTestContainer } from '../helpers/testContainer';
import { seedBasic } from '../helpers/seed';
import { createApp } from '../../src/app';
import type { IConcertController } from '../../src/controllers/ConcertController';
import type { IReserveController } from '../../src/controllers/ReserveController';
import type { IOrderController } from '../../src/controllers/OrderController';
import type { ISeatController } from '../../src/controllers/SeatController';

const MISSING_UUID = '00000000-0000-0000-0000-000000000000';

describe('POST /api/v1/orders/:id/confirm (API, supertest)', () => {
    let ds: DataSource;
    let app: ReturnType<typeof createApp>;

    beforeEach(async () => {
        ds = createTestDataSource();
        await ds.initialize();
        const c = buildTestContainer(ds);
        app = createApp({
            concertController: c.resolve<IConcertController>('IConcertController'),
            reserveController: c.resolve<IReserveController>('IReserveController'),
            orderController: c.resolve<IOrderController>('IOrderController'),
            seatController: c.resolve<ISeatController>('ISeatController'),
        });
    });
    afterEach(async () => {
        await ds.destroy();
    });

    async function holdOne() {
        const { concertId, userId } = await seedBasic(ds);
        const hold = await request(app)
            .post('/api/v1/reserves')
            .send({ userId, concertId, seats: ['A1'] });
        return { orderId: hold.body.data.order.id as string, userId };
    }

    it('200 confirms a held order and issues tickets', async () => {
        const { orderId, userId } = await holdOne();
        const res = await request(app).post(`/api/v1/orders/${orderId}/confirm`).send({ userId });
        expect(res.status).toBe(200);
        expect(res.body.data.tickets).toHaveLength(1);
        expect(res.body.data.order.status).toBe('confirmed');
    });

    it('404 for a non-existent order', async () => {
        const { userId } = await seedBasic(ds);
        const res = await request(app).post(`/api/v1/orders/${MISSING_UUID}/confirm`).send({ userId });
        expect(res.status).toBe(404);
    });

    it('200 idempotent on double-confirm — replays the same tickets (§7)', async () => {
        const { orderId, userId } = await holdOne();
        const first = await request(app).post(`/api/v1/orders/${orderId}/confirm`).send({ userId });
        const second = await request(app).post(`/api/v1/orders/${orderId}/confirm`).send({ userId });
        expect(second.status).toBe(200);
        expect(second.body.data.order.status).toBe('confirmed');
        // Same tickets back, not a new sale.
        expect(second.body.data.tickets.map((t: { id: string }) => t.id).sort()).toEqual(
            first.body.data.tickets.map((t: { id: string }) => t.id).sort(),
        );
    });

    it('400 on a non-UUID order id', async () => {
        const res = await request(app).post('/api/v1/orders/not-a-uuid/confirm').send({ userId: MISSING_UUID });
        expect(res.status).toBe(400);
    });

    it('400 when userId is missing from the body', async () => {
        const { orderId } = await holdOne();
        const res = await request(app).post(`/api/v1/orders/${orderId}/confirm`).send({});
        expect(res.status).toBe(400);
    });
});
