import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestDataSource } from '../helpers/testDataSource';
import { buildTestContainer } from '../helpers/testContainer';
import { seedUser } from '../helpers/seed';
import { bearer } from '../helpers/auth';
import { createApp } from '../../src/app';
import { Credential } from '../../src/entities/Credential';
import type { IConcertController } from '../../src/controllers/ConcertController';
import type { IReserveController } from '../../src/controllers/ReserveController';
import type { IOrderController } from '../../src/controllers/OrderController';
import type { ISeatController } from '../../src/controllers/SeatController';
import type { IAuthController } from '../../src/controllers/AuthController';

/**
 * Multi-device passkey management (A3b). The add ceremony's /verify needs a real attestation (unit-
 * tested with a mocked verifier); list / delete / begin-add are testable end to end here.
 */
describe('Passkey management — /auth/credentials (API)', () => {
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

    const addCredential = (userId: string, credentialId: string, nickname?: string) =>
        ds.getRepository(Credential).save({
            user: { id: userId },
            credentialId,
            publicKey: 'pk',
            counter: 0,
            backedUp: false,
            nickname,
        } as Credential);

    it('401 listing without a token', async () => {
        const res = await request(app).get('/api/v1/auth/credentials');
        expect(res.status).toBe(401);
    });

    it('lists my passkeys, sanitized — no key material', async () => {
        const user = await seedUser(ds);
        await addCredential(user.id, 'c1', 'Phone');
        await addCredential(user.id, 'c2', 'Laptop');
        const res = await request(app)
            .get('/api/v1/auth/credentials')
            .set(...bearer(user.id));
        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(2);
        expect(res.body.data[0].publicKey).toBeUndefined();
        expect(res.body.data[0].credentialId).toBeUndefined();
        expect(res.body.data.map((c: { nickname: string }) => c.nickname).sort()).toEqual(['Laptop', 'Phone']);
    });

    it('removes a passkey when more than one exists (204), then it is gone', async () => {
        const user = await seedUser(ds);
        const c1 = await addCredential(user.id, 'c1');
        await addCredential(user.id, 'c2');
        const del = await request(app)
            .delete(`/api/v1/auth/credentials/${c1.id}`)
            .set(...bearer(user.id));
        expect(del.status).toBe(204);
        const list = await request(app)
            .get('/api/v1/auth/credentials')
            .set(...bearer(user.id));
        expect(list.body.data).toHaveLength(1);
    });

    it('409 when removing the only passkey (anti-lockout guard)', async () => {
        const user = await seedUser(ds);
        const only = await addCredential(user.id, 'c1');
        const del = await request(app)
            .delete(`/api/v1/auth/credentials/${only.id}`)
            .set(...bearer(user.id));
        expect(del.status).toBe(409);
    });

    it('cannot delete another user’s passkey (404, scoped to owner)', async () => {
        const me = await seedUser(ds);
        await addCredential(me.id, 'mine1');
        await addCredential(me.id, 'mine2'); // I have 2, so the anti-lockout guard passes
        const other = await seedUser(ds);
        const theirs = await addCredential(other.id, 'theirs');
        const del = await request(app)
            .delete(`/api/v1/auth/credentials/${theirs.id}`)
            .set(...bearer(me.id));
        expect(del.status).toBe(404);
    });

    it('begin add-passkey returns creation options for the logged-in user', async () => {
        const user = await seedUser(ds);
        const res = await request(app)
            .post('/api/v1/auth/credentials/options')
            .set(...bearer(user.id));
        expect(res.status).toBe(200);
        expect(res.body.data.challenge).toBeDefined();
    });
});
