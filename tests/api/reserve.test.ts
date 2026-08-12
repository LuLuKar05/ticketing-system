import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestDataSource } from '../helpers/testDataSource';
import { buildTestContainer } from '../helpers/testContainer';
import { seedBasic, seedUser } from '../helpers/seed';
import { bearer } from '../helpers/auth';
import { ConcertStatus } from '../../src/entities/Concert';
import { createApp } from '../../src/app';
import type { IConcertController } from '../../src/controllers/ConcertController';
import type { IReserveController } from '../../src/controllers/ReserveController';
import type { IOrderController } from '../../src/controllers/OrderController';
import type { ISeatController } from '../../src/controllers/SeatController';

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
            seatController: c.resolve<ISeatController>('ISeatController'),
        });
    });
    afterEach(async () => {
        await ds.destroy();
    });

    it('401 without a session token', async () => {
        const { concertId } = await seedBasic(ds);
        const res = await request(app)
            .post('/api/v1/reserves')
            .send({ concertId, seats: ['A1'] });
        expect(res.status).toBe(401);
    });

    it('201 holds the requested seats (identity from the token, not the body)', async () => {
        const { concertId, userId } = await seedBasic(ds);
        const res = await request(app)
            .post('/api/v1/reserves')
            .set(...bearer(userId))
            .send({ concertId, seats: ['A1'] });
        expect(res.status).toBe(201);
        expect(res.body.status).toBe('success');
        expect(res.body.data.order.id).toBeDefined();
    });

    it('400 when the body fails validation (missing seats)', async () => {
        const { concertId, userId } = await seedBasic(ds);
        const res = await request(app)
            .post('/api/v1/reserves')
            .set(...bearer(userId))
            .send({ concertId });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/validation/i);
    });

    it('400 when concertId is not a UUID', async () => {
        const res = await request(app)
            .post('/api/v1/reserves')
            .set(...bearer(MISSING_UUID))
            .send({ concertId: 'nope', seats: ['A1'] });
        expect(res.status).toBe(400);
    });

    it('400 when a stray userId is sent in the body (strict, mass-assignment)', async () => {
        const { concertId, userId } = await seedBasic(ds);
        const res = await request(app)
            .post('/api/v1/reserves')
            .set(...bearer(userId))
            .send({ userId, concertId, seats: ['A1'] });
        expect(res.status).toBe(400);
    });

    it('400 when seats is empty', async () => {
        const { concertId, userId } = await seedBasic(ds);
        const res = await request(app)
            .post('/api/v1/reserves')
            .set(...bearer(userId))
            .send({ concertId, seats: [] });
        expect(res.status).toBe(400);
    });

    it('409 with seatNumbers when a seat is already held (by another user)', async () => {
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
        expect(res.body.reason).toBe('held');
        expect(res.body.seatNumbers).toContain('A1');
    });

    it('400 for a seat that is not in the catalog (closes the free-form-seat / over-hold hole)', async () => {
        const { concertId, userId } = await seedBasic(ds);
        const res = await request(app)
            .post('/api/v1/reserves')
            .set(...bearer(userId))
            .send({ concertId, seats: ['ZZZ-9999'] });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/unknown seat/i);
    });

    it('422 when the concert is cancelled (§3.1)', async () => {
        const { concertId, userId } = await seedBasic(ds, { status: ConcertStatus.CANCELLED });
        const res = await request(app)
            .post('/api/v1/reserves')
            .set(...bearer(userId))
            .send({ concertId, seats: ['A1'] });
        expect(res.status).toBe(422);
    });

    it('404 when the concert does not exist', async () => {
        const { userId } = await seedBasic(ds);
        const res = await request(app)
            .post('/api/v1/reserves')
            .set(...bearer(userId))
            .send({ concertId: MISSING_UUID, seats: ['A1'] });
        expect(res.status).toBe(404);
    });

    it('400 on a malformed JSON body (not 500)', async () => {
        const res = await request(app)
            .post('/api/v1/reserves')
            .set(...bearer(MISSING_UUID))
            .set('Content-Type', 'application/json')
            .send('{"concertId": '); // truncated → body-parser SyntaxError
        expect(res.status).toBe(400);
    });
});
