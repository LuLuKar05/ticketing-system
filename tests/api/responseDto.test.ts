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

describe('Response DTOs — the API returns ONLY whitelisted fields (OWASP API3, exposure half)', () => {
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

    it('POST /reserves → order DTO has exactly {id,status,totalAmount} (no user, no timestamps)', async () => {
        const { concertId, userId } = await seedBasic(ds);
        const res = await request(app)
            .post('/api/v1/reserves')
            .set(...bearer(userId))
            .send({ concertId, seats: ['A1'] });
        expect(res.status).toBe(201);
        expect(Object.keys(res.body.data.order).sort()).toEqual(['id', 'status', 'totalAmount']);
        expect(res.body.data.order.user).toBeUndefined();
        expect(res.body.data.order.createdAt).toBeUndefined();
    });

    it('POST /orders/:id/confirm → ticket DTOs drop the user/ticketTier/order relations', async () => {
        const { concertId, userId } = await seedBasic(ds);
        const hold = await request(app)
            .post('/api/v1/reserves')
            .set(...bearer(userId))
            .send({ concertId, seats: ['A1'] });
        const orderId = hold.body.data.order.id;

        const res = await request(app)
            .post(`/api/v1/orders/${orderId}/confirm`)
            .set(...bearer(userId))
            .send({});
        expect(res.status).toBe(200);
        const ticket = res.body.data.tickets[0];
        expect(Object.keys(ticket).sort()).toEqual(['id', 'pricePaid', 'seatNumber', 'status']);
        expect(ticket.user).toBeUndefined();
        expect(ticket.ticketTier).toBeUndefined();
        expect(res.body.data.order.user).toBeUndefined();
    });

    it('GET /concerts/:id → detail exposes description but not DB timestamps; tiers are {id,name,price}', async () => {
        const { concertId } = await seedBasic(ds);
        const res = await request(app).get(`/api/v1/concerts/${concertId}`);
        expect(res.status).toBe(200);
        expect(res.body.data.description).toBeDefined(); // public detail field, intentionally exposed
        expect(res.body.data.createdAt).toBeUndefined(); // internal, never leaked
        expect(res.body.data.updatedAt).toBeUndefined();
        expect(Object.keys(res.body.data.ticketTiers[0]).sort()).toEqual(['id', 'name', 'price']);
    });

    it('GET /concerts → list items carry no timestamps', async () => {
        await seedBasic(ds);
        const res = await request(app).get('/api/v1/concerts?status=all');
        expect(res.status).toBe(200);
        expect(res.body.data[0].createdAt).toBeUndefined();
        expect(res.body.data[0].updatedAt).toBeUndefined();
    });
});
