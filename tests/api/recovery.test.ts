import request from 'supertest';
import { DataSource } from 'typeorm';
import bcrypt from 'bcryptjs';
import { createTestDataSource } from '../helpers/testDataSource';
import { buildTestContainer } from '../helpers/testContainer';
import { seedUser } from '../helpers/seed';
import { setRecovery } from '../../src/auth/recoveryStore';
import { createApp } from '../../src/app';
import type { IConcertController } from '../../src/controllers/ConcertController';
import type { IReserveController } from '../../src/controllers/ReserveController';
import type { IOrderController } from '../../src/controllers/OrderController';
import type { ISeatController } from '../../src/controllers/SeatController';
import type { IAuthController } from '../../src/controllers/AuthController';

/**
 * Recovery guard behaviors + the /verify step are testable end to end (the code is seeded directly);
 * /complete's happy path needs a real attestation and is covered by the AuthService unit test.
 */
describe('Account recovery — /auth/recover* (API)', () => {
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

    it('recover: 200 for a known email', async () => {
        const user = await seedUser(ds);
        const res = await request(app).post('/api/v1/auth/recover').send({ email: user.email });
        expect(res.status).toBe(200);
    });

    it('recover: 200 for an unknown email (no enumeration — same response)', async () => {
        const res = await request(app).post('/api/v1/auth/recover').send({ email: 'ghost@example.com' });
        expect(res.status).toBe(200);
    });

    it('recover/verify: correct code → 200 with passkey options + a recovery_id cookie', async () => {
        const user = await seedUser(ds);
        await setRecovery(user.email.toLowerCase(), {
            codeHash: await bcrypt.hash('123456', 10),
            userId: user.id,
            attemptsLeft: 5,
        });
        const res = await request(app).post('/api/v1/auth/recover/verify').send({ email: user.email, code: '123456' });
        expect(res.status).toBe(200);
        expect(res.body.data.challenge).toBeDefined();
        expect(((res.headers['set-cookie'] as unknown as string[] | undefined) ?? []).join(';')).toMatch(
            /recovery_id=/,
        );
    });

    it('recover/verify: wrong code → 401', async () => {
        const user = await seedUser(ds);
        await setRecovery(user.email.toLowerCase(), {
            codeHash: await bcrypt.hash('123456', 10),
            userId: user.id,
            attemptsLeft: 5,
        });
        const res = await request(app).post('/api/v1/auth/recover/verify').send({ email: user.email, code: '000000' });
        expect(res.status).toBe(401);
    });

    it('recover/verify: 400 on a non-6-digit code', async () => {
        const res = await request(app).post('/api/v1/auth/recover/verify').send({ email: 'a@b.com', code: 'abcdef' });
        expect(res.status).toBe(400);
    });

    it('recover/complete: 401 without a recovery cookie', async () => {
        const res = await request(app)
            .post('/api/v1/auth/recover/complete')
            .send({ response: { id: 'x' } });
        expect(res.status).toBe(401);
    });
});
