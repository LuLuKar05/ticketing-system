import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestDataSource } from '../helpers/testDataSource';
import { buildTestContainer } from '../helpers/testContainer';
import { seedConcert, seedTier } from '../helpers/seed';
import { ConcertStatus } from '../../src/entities/Concert';
import { createApp } from '../../src/app';
import type { IConcertController } from '../../src/controllers/ConcertController';
import type { IReserveController } from '../../src/controllers/ReserveController';
import type { IOrderController } from '../../src/controllers/OrderController';

const MISSING_UUID = '00000000-0000-0000-0000-000000000000';

describe('Concerts API (supertest)', () => {
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

    // Regression guard for bug 2.1 (stale SELECT crashed this on every call).
    it('GET /concerts → 200 with a list', async () => {
        await seedConcert(ds);
        const res = await request(app).get('/api/v1/concerts');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.data)).toBe(true);
        expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    });

    // Regression guard for bug 2.2 (read req.body on a GET → crashed on every call).
    it('GET /concerts/:id → 200 for an existing concert', async () => {
        const concert = await seedConcert(ds);
        const res = await request(app).get(`/api/v1/concerts/${concert.id}`);
        expect(res.status).toBe(200);
        expect(res.body.data.id).toBe(concert.id);
    });

    it('GET /concerts/:id → includes ticketTiers (detail view)', async () => {
        const concert = await seedConcert(ds);
        await seedTier(ds, concert.id, { name: 'VIP', price: 15000 });
        const res = await request(app).get(`/api/v1/concerts/${concert.id}`);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.data.ticketTiers)).toBe(true);
        expect(res.body.data.ticketTiers).toHaveLength(1);
        expect(res.body.data.ticketTiers[0].price).toBe(15000);
    });

    it('GET /concerts/:id → 404 for a valid but missing id', async () => {
        const res = await request(app).get(`/api/v1/concerts/${MISSING_UUID}`);
        expect(res.status).toBe(404);
    });

    it('GET /concerts/:id → 400 for a non-UUID id (param validation)', async () => {
        const res = await request(app).get('/api/v1/concerts/not-a-uuid');
        expect(res.status).toBe(400);
    });

    it('GET /concerts?status=upcoming → 200 (valid filter)', async () => {
        await seedConcert(ds);
        const res = await request(app).get('/api/v1/concerts?status=upcoming');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('GET /concerts?status=garbage → 400 (query validation)', async () => {
        const res = await request(app).get('/api/v1/concerts?status=garbage');
        expect(res.status).toBe(400);
    });

    it('GET /concerts (default) → only upcoming/ongoing, hides cancelled', async () => {
        await seedConcert(ds); // upcoming (entity default)
        await seedConcert(ds, { status: ConcertStatus.CANCELLED });
        const res = await request(app).get('/api/v1/concerts');
        expect(res.status).toBe(200);
        expect(res.body.data.every((c: { status: string }) => c.status === 'upcoming' || c.status === 'ongoing')).toBe(true);
    });

    it('GET /concerts?status=all → every status, including cancelled', async () => {
        await seedConcert(ds); // upcoming
        await seedConcert(ds, { status: ConcertStatus.CANCELLED });
        const res = await request(app).get('/api/v1/concerts?status=all');
        expect(res.status).toBe(200);
        expect(res.body.data.map((c: { status: string }) => c.status)).toContain('cancelled');
    });
});
