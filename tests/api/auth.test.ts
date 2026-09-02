import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestDataSource } from '../helpers/testDataSource';
import { buildTestContainer } from '../helpers/testContainer';
import { createApp } from '../../src/app';
import type { IConcertController } from '../../src/controllers/ConcertController';
import type { IReserveController } from '../../src/controllers/ReserveController';
import type { IOrderController } from '../../src/controllers/OrderController';
import type { ISeatController } from '../../src/controllers/SeatController';
import type { IAuthController } from '../../src/controllers/AuthController';

/**
 * The registration ceremony's step 1 (`/options`) needs no authenticator, so it's testable end to
 * end. Step 2 (`/verify`) requires a real browser attestation and is covered by the AuthService unit
 * test with a mocked verifier.
 */
describe('POST /api/v1/auth/register/options (API)', () => {
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
            authController: c.resolve<IAuthController>('IAuthController'),
        });
    });
    afterEach(async () => {
        await ds.destroy();
    });

    it('200 returns creation options with a challenge', async () => {
        const res = await request(app).post('/api/v1/auth/register/options').send({ email: 'newuser@example.com' });
        expect(res.status).toBe(200);
        expect(res.body.data.challenge).toBeDefined();
        expect(res.body.data.rp).toBeDefined();
        expect(res.body.data.pubKeyCredParams).toBeDefined();
    });

    it('400 on a non-email', async () => {
        const res = await request(app).post('/api/v1/auth/register/options').send({ email: 'not-an-email' });
        expect(res.status).toBe(400);
    });

    it('400 on unknown extra fields (strict body)', async () => {
        const res = await request(app).post('/api/v1/auth/register/options').send({ email: 'a@b.com', injected: 'x' });
        expect(res.status).toBe(400);
    });

    it('login/options: 200 with a challenge even for an unknown email (no enumeration), sets login_id cookie', async () => {
        const res = await request(app).post('/api/v1/auth/login/options').send({ email: 'ghost@example.com' });
        expect(res.status).toBe(200);
        expect(res.body.data.challenge).toBeDefined();
        // unknown account → empty allow-list, but still valid options
        expect(res.body.data.allowCredentials).toEqual([]);
        // the challenge is correlated by a login_id cookie (works with or without an email)
        expect(((res.headers['set-cookie'] as unknown as string[] | undefined) ?? []).join(';')).toMatch(/login_id=/);
    });

    it('login/options: usernameless (no email) returns discoverable options + a login_id cookie', async () => {
        const res = await request(app).post('/api/v1/auth/login/options').send({});
        expect(res.status).toBe(200);
        expect(res.body.data.challenge).toBeDefined();
        expect(res.body.data.allowCredentials).toEqual([]);
        expect(((res.headers['set-cookie'] as unknown as string[] | undefined) ?? []).join(';')).toMatch(/login_id=/);
    });

    it('login/verify: 401 without a login_id cookie', async () => {
        const res = await request(app)
            .post('/api/v1/auth/login/verify')
            .send({ response: { id: 'x' } });
        expect(res.status).toBe(401);
    });
});
