import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestDataSource } from '../helpers/testDataSource';
import { buildTestContainer } from '../helpers/testContainer';
import { seedBasic, seedUser } from '../helpers/seed';
import { bearer } from '../helpers/auth';
import { createApp } from '../../src/app';
import { ServiceUnavailableError } from '../../src/error';
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
        const res = await request(app)
            .post('/api/v1/reserves')
            .set(...bearer(userId))
            .send({ concertId }); // no seats
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('VALIDATION_ERROR');
        expect(typeof res.body.message).toBe('string');
        expect(res.body.ref).toBe(res.headers['x-correlation-id']);
    });

    it('domain error → code + statusCode from the error (SEATS_UNAVAILABLE keeps seatNumbers/reason)', async () => {
        const { concertId, userId } = await seedBasic(ds);
        const other = await seedUser(ds);
        await request(app)
            .post('/api/v1/reserves')
            .set(...bearer(userId))
            .send({ concertId, seats: ['A1'] });
        const res = await request(app)
            .post('/api/v1/reserves')
            .set(...bearer(other.id))
            .send({ concertId, seats: ['A1'] });
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
            .set(...bearer(userId))
            .send({ concertId: '00000000-0000-0000-0000-000000000000', seats: ['A1'] });
        expect(res.status).toBe(404);
        expect(res.body.error).toBe('NOT_FOUND');
    });

    it('ServiceUnavailableError → 503 + a Retry-After header (dependency down, not a bug)', async () => {
        // A stub controller stands in for "Redis is unreachable inside the auth stores": those now
        // fail CLOSED with this error rather than throwing a raw 500. See tests/unit/redisFailClosed.
        const failing = createApp({
            concertController: {
                getConcerts: () => Promise.reject(new ServiceUnavailableError()),
                getConcertById: () => Promise.resolve(),
                cancelConcertById: () => Promise.resolve(),
            },
            // The other routers are mounted but never hit here; their handlers are resolved lazily.
            reserveController: {} as IReserveController,
            orderController: {} as IOrderController,
            seatController: {} as ISeatController,
        });
        const res = await request(failing).get('/api/v1/concerts');
        expect(res.status).toBe(503);
        expect(res.body.error).toBe('SERVICE_UNAVAILABLE');
        expect(res.headers['retry-after']).toBe('5');
        expect(res.body.ref).toBe(res.headers['x-correlation-id']);
    });

    it('unmatched route → 404 NOT_FOUND with a ref', async () => {
        const res = await request(app).get('/api/v1/nope');
        expect(res.status).toBe(404);
        expect(res.body.error).toBe('NOT_FOUND');
        expect(res.body.ref).toBe(res.headers['x-correlation-id']);
    });
});
