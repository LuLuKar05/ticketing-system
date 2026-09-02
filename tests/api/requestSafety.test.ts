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

describe('Request safety (OWASP-informed input hardening)', () => {
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

    it('API3 (mass assignment): rejects an unknown property → 400 VALIDATION_ERROR', async () => {
        const { concertId, userId } = await seedBasic(ds);
        const res = await request(app)
            .post('/api/v1/reserves')
            .set(...bearer(userId))
            .send({ concertId, seats: ['A1'], isAdmin: true });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('API4 (resource caps): rejects more than 5 seats → 400', async () => {
        const { concertId, userId } = await seedBasic(ds);
        const res = await request(app)
            .post('/api/v1/reserves')
            .set(...bearer(userId))
            .send({ concertId, seats: ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'] });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('API4 (body size): rejects an oversized body → 413 PAYLOAD_TOO_LARGE', async () => {
        const { concertId, userId } = await seedBasic(ds);
        const res = await request(app)
            .post('/api/v1/reserves')
            .set(...bearer(userId))
            .send({ concertId, seats: ['A1'], junk: 'x'.repeat(20_000) });
        expect(res.status).toBe(413);
        expect(res.body.error).toBe('PAYLOAD_TOO_LARGE');
    });

    it('strict query: rejects an unknown query param on GET /concerts → 400', async () => {
        const res = await request(app).get('/api/v1/concerts?status=upcoming&evil=1');
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('API8 (security headers): helmet sets sane defaults + locks inline scripts by default', async () => {
        const res = await request(app).get('/health');
        expect(res.headers['x-content-type-options']).toBe('nosniff');
        expect(res.headers['x-dns-prefetch-control']).toBeDefined();
        // scripts are strict by default — no inline execution allowed (XSS defense)
        expect(res.headers['content-security-policy']).toContain("script-src 'self'");
        expect(res.headers['content-security-policy']).not.toContain("script-src 'self' 'unsafe-inline'");
    });

    it('CSP relaxation is SCOPED to the Swagger docs route, not global', async () => {
        const docs = await request(app).get('/api/v1/docs/');
        // the docs page allows inline scripts (Swagger needs them) …
        expect(docs.headers['content-security-policy']).toContain("script-src 'self' 'unsafe-inline'");
        // … while a normal API route keeps inline scripts locked
        const api = await request(app).get('/health');
        expect(api.headers['content-security-policy']).not.toContain("script-src 'self' 'unsafe-inline'");
    });
});
