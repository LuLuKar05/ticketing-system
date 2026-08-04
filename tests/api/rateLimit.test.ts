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

// Under NODE_ENV=test the limiter uses an in-memory store; each createApp() gets a fresh counter.
describe('Rate limiting — POST /reserves (per-IP, 5/min sliding window)', () => {
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

    it('returns 429 RATE_LIMITED once the per-IP limit is exceeded', async () => {
        const { concertId, userId } = await seedBasic(ds);
        const body = { userId, concertId, seats: ['A1'] };

        // The limiter runs before validation/handler, so it counts every request regardless of its
        // outcome. Points default to 5 → the 6th request from this IP is rejected by the limiter.
        let last = await request(app).post('/api/v1/reserves').send(body);
        for (let i = 0; i < 5; i++) {
            last = await request(app).post('/api/v1/reserves').send(body);
        }

        expect(last.status).toBe(429);
        expect(last.body.error).toBe('RATE_LIMITED');
        expect(last.headers['retry-after']).toBeDefined();
    });
});
