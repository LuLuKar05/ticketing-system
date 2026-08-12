import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestDataSource } from '../helpers/testDataSource';
import { buildTestContainer } from '../helpers/testContainer';
import { seedBasic } from '../helpers/seed';
import { bearer } from '../helpers/auth';
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
            .set(...bearer(userId))
            .send({ concertId, seats: ['A1'] });
        return { orderId: hold.body.data.order.id as string, userId };
    }

    it('401 without a session token', async () => {
        const { orderId } = await holdOne();
        const res = await request(app).post(`/api/v1/orders/${orderId}/confirm`).send({});
        expect(res.status).toBe(401);
    });

    it('200 confirms a held order and issues tickets (payer from the token)', async () => {
        const { orderId, userId } = await holdOne();
        const res = await request(app)
            .post(`/api/v1/orders/${orderId}/confirm`)
            .set(...bearer(userId))
            .send({});
        expect(res.status).toBe(200);
        expect(res.body.data.tickets).toHaveLength(1);
        expect(res.body.data.order.status).toBe('confirmed');
    });

    it('404 for a non-existent order', async () => {
        const { userId } = await seedBasic(ds);
        const res = await request(app)
            .post(`/api/v1/orders/${MISSING_UUID}/confirm`)
            .set(...bearer(userId))
            .send({});
        expect(res.status).toBe(404);
    });

    it('200 idempotent on double-confirm — replays the same tickets (§7)', async () => {
        const { orderId, userId } = await holdOne();
        const first = await request(app)
            .post(`/api/v1/orders/${orderId}/confirm`)
            .set(...bearer(userId))
            .send({});
        const second = await request(app)
            .post(`/api/v1/orders/${orderId}/confirm`)
            .set(...bearer(userId))
            .send({});
        expect(second.status).toBe(200);
        expect(second.body.data.order.status).toBe('confirmed');
        // Same tickets back, not a new sale.
        expect(second.body.data.tickets.map((t: { id: string }) => t.id).sort()).toEqual(
            first.body.data.tickets.map((t: { id: string }) => t.id).sort(),
        );
    });

    it('400 on a non-UUID order id', async () => {
        const res = await request(app)
            .post('/api/v1/orders/not-a-uuid/confirm')
            .set(...bearer(MISSING_UUID))
            .send({});
        expect(res.status).toBe(400);
    });

    it('400 when a stray field is sent in the body (strict, mass-assignment)', async () => {
        const { orderId, userId } = await holdOne();
        const res = await request(app)
            .post(`/api/v1/orders/${orderId}/confirm`)
            .set(...bearer(userId))
            .send({ userId });
        expect(res.status).toBe(400);
    });
});
