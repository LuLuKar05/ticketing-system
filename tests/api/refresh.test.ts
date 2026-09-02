import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestDataSource } from '../helpers/testDataSource';
import { buildTestContainer } from '../helpers/testContainer';
import { seedUser } from '../helpers/seed';
import { issueRefreshToken } from '../../src/auth/refreshToken';
import { createApp } from '../../src/app';
import type { IConcertController } from '../../src/controllers/ConcertController';
import type { IReserveController } from '../../src/controllers/ReserveController';
import type { IOrderController } from '../../src/controllers/OrderController';
import type { ISeatController } from '../../src/controllers/SeatController';
import type { IAuthController } from '../../src/controllers/AuthController';

describe('Session refresh + logout (API)', () => {
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

    it('401 refreshing without a token', async () => {
        const res = await request(app).post('/api/v1/auth/refresh').send({});
        expect(res.status).toBe(401);
    });

    it('a valid refresh token yields a new access + a rotated refresh token', async () => {
        const user = await seedUser(ds);
        const rt = await issueRefreshToken(user.id);
        const res = await request(app).post('/api/v1/auth/refresh').set('Cookie', `refresh_token=${rt}`).send({});
        expect(res.status).toBe(200);
        expect(res.body.data.token).toBeDefined();
        expect(res.body.data.refreshToken).toBeDefined();
        expect(res.body.data.refreshToken).not.toBe(rt);
    });

    it('reusing the old refresh token after rotation → 401, and the family is revoked', async () => {
        const user = await seedUser(ds);
        const rt = await issueRefreshToken(user.id);
        const first = await request(app).post('/api/v1/auth/refresh').set('Cookie', `refresh_token=${rt}`).send({});
        const rotated = first.body.data.refreshToken as string;

        const reuse = await request(app).post('/api/v1/auth/refresh').set('Cookie', `refresh_token=${rt}`).send({});
        expect(reuse.status).toBe(401);
        // the token that WAS valid is dead too — the whole family was burned
        const dead = await request(app).post('/api/v1/auth/refresh').set('Cookie', `refresh_token=${rotated}`).send({});
        expect(dead.status).toBe(401);
    });

    it('accepts the refresh token from the body (non-browser clients)', async () => {
        const user = await seedUser(ds);
        const rt = await issueRefreshToken(user.id);
        const res = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: rt });
        expect(res.status).toBe(200);
    });

    it('logout revokes the family — a later refresh fails', async () => {
        const user = await seedUser(ds);
        const rt = await issueRefreshToken(user.id);
        const out = await request(app).post('/api/v1/auth/logout').set('Cookie', `refresh_token=${rt}`).send({});
        expect(out.status).toBe(204);
        const after = await request(app).post('/api/v1/auth/refresh').set('Cookie', `refresh_token=${rt}`).send({});
        expect(after.status).toBe(401);
    });
});
