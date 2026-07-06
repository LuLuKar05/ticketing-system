import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestDataSource } from '../helpers/testDataSource';
import { buildTestContainer } from '../helpers/testContainer';
import { seedBasic } from '../helpers/seed';
import { createApp } from '../../src/app';
import type { IConcertController } from '../../src/controllers/ConcertController';
import type { IReserveController } from '../../src/controllers/ReserveController';
import type { IOrderController } from '../../src/controllers/OrderController';

const MISSING_UUID = '00000000-0000-0000-0000-000000000000';

describe('POST /api/v1/reserves (API, supertest)', () => {
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
        });
    });
    afterEach(async () => {
        await ds.destroy();
    });

    it('201 holds the requested seats', async () => {
        const { concertId, tierId, userId } = await seedBasic(ds);
        const res = await request(app).post('/api/v1/reserves').send({ userId, concertId, seats: [{ tierId, seatNumber: 'A1' }] });
        expect(res.status).toBe(201);
        expect(res.body.status).toBe('success');
        expect(res.body.data.order.id).toBeDefined();
    });

    it('400 when the body fails validation (missing seats)', async () => {
        const { concertId, userId } = await seedBasic(ds);
        const res = await request(app).post('/api/v1/reserves').send({ userId, concertId });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/validation/i);
    });

    it('400 when ids are not UUIDs', async () => {
        const res = await request(app).post('/api/v1/reserves').send({ userId: 'nope', concertId: 'nope', seats: [{ tierId: 'nope', seatNumber: 'A1' }] });
        expect(res.status).toBe(400);
    });

    it('400 when seats is empty', async () => {
        const { concertId, userId } = await seedBasic(ds);
        const res = await request(app).post('/api/v1/reserves').send({ userId, concertId, seats: [] });
        expect(res.status).toBe(400);
    });

    it('409 with seatNumbers when a seat is already held', async () => {
        const { concertId, tierId, userId } = await seedBasic(ds);
        await request(app).post('/api/v1/reserves').send({ userId, concertId, seats: [{ tierId, seatNumber: 'A1' }] });
        const res = await request(app).post('/api/v1/reserves').send({ userId, concertId, seats: [{ tierId, seatNumber: 'A1' }] });
        expect(res.status).toBe(409);
        expect(res.body.reason).toBe('held');
        expect(res.body.seatNumbers).toContain('A1');
    });

    it('404 when the concert does not exist', async () => {
        const { tierId, userId } = await seedBasic(ds);
        const res = await request(app).post('/api/v1/reserves').send({ userId, concertId: MISSING_UUID, seats: [{ tierId, seatNumber: 'A1' }] });
        expect(res.status).toBe(404);
    });
});
