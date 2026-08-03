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

describe('Global error mapper — { error, message, ref } contract', () => {
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

    it('validation failure → 400 VALIDATION_ERROR, and ref equals the correlation header', async () => {
        const { concertId, userId } = await seedBasic(ds);
        const res = await request(app).post('/api/v1/reserves').send({ userId, concertId }); // no seats
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('VALIDATION_ERROR');
        expect(typeof res.body.message).toBe('string');
        expect(res.body.ref).toBe(res.headers['x-correlation-id']);
    });

    it('domain error → code + statusCode from the error (SEATS_UNAVAILABLE keeps seatNumbers/reason)', async () => {
        const { concertId, userId } = await seedBasic(ds);
        await request(app)
            .post('/api/v1/reserves')
            .send({ userId, concertId, seats: ['A1'] });
        const res = await request(app)
            .post('/api/v1/reserves')
            .send({ userId, concertId, seats: ['A1'] });
        expect(res.status).toBe(409);
        expect(res.body.error).toBe('SEATS_UNAVAILABLE');
        expect(res.body.reason).toBe('held');
        expect(res.body.seatNumbers).toContain('A1');
        expect(res.body.ref).toBe(res.headers['x-correlation-id']);
    });

    it('NotFoundError → 404 NOT_FOUND', async () => {
        const { userId } = await seedBasic(ds);
        const res = await request(app)
            .post('/api/v1/reserves')
            .send({ userId, concertId: '00000000-0000-0000-0000-000000000000', seats: ['A1'] });
        expect(res.status).toBe(404);
        expect(res.body.error).toBe('NOT_FOUND');
    });

    it('unmatched route → 404 NOT_FOUND with a ref', async () => {
        const res = await request(app).get('/api/v1/nope');
        expect(res.status).toBe(404);
        expect(res.body.error).toBe('NOT_FOUND');
        expect(res.body.ref).toBe(res.headers['x-correlation-id']);
    });
});
