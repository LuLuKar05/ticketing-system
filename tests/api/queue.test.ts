import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestDataSource } from '../helpers/testDataSource';
import { buildTestContainer } from '../helpers/testContainer';
import { seedBasic } from '../helpers/seed';
import { bearer } from '../helpers/auth';
import { Concert } from '../../src/entities/Concert';
import { createApp } from '../../src/app';
import type { IConcertController } from '../../src/controllers/ConcertController';
import type { IReserveController } from '../../src/controllers/ReserveController';
import type { IOrderController } from '../../src/controllers/OrderController';
import type { ISeatController } from '../../src/controllers/SeatController';
import type { IQueueController } from '../../src/controllers/QueueController';
import type { IQueueService } from '../../src/services/QueueService';

describe('Waiting-room queue (API)', () => {
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
            queueController: c.resolve<IQueueController>('IQueueController'),
            queueService: c.resolve<IQueueService>('IQueueService'),
        });
    });
    afterEach(async () => {
        await ds.destroy();
    });

    const gate = (concertId: string) => ds.getRepository(Concert).update(concertId, { gatedOnSale: true });

    it('401 joining without a token', async () => {
        const { concertId } = await seedBasic(ds);
        const res = await request(app).post(`/api/v1/concerts/${concertId}/queue/join`).send();
        expect(res.status).toBe(401);
    });

    it('non-gated concert: join → admitted immediately (gated:false)', async () => {
        const { concertId, userId } = await seedBasic(ds);
        const res = await request(app)
            .post(`/api/v1/concerts/${concertId}/queue/join`)
            .set(...bearer(userId))
            .send();
        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ gated: false, admitted: true });
    });

    it('gated concert: join → gated:true and admitted (within the cap)', async () => {
        const { concertId, userId } = await seedBasic(ds);
        await gate(concertId);
        const res = await request(app)
            .post(`/api/v1/concerts/${concertId}/queue/join`)
            .set(...bearer(userId))
            .send();
        expect(res.status).toBe(200);
        expect(res.body.data.gated).toBe(true);
        expect(res.body.data.admitted).toBe(true);
    });

    it('non-gated concert: /reserves works without joining the queue', async () => {
        const { concertId, userId } = await seedBasic(ds);
        const res = await request(app)
            .post('/api/v1/reserves')
            .set(...bearer(userId))
            .send({ concertId, seats: ['A1'] });
        expect(res.status).toBe(201);
    });

    it('gating: a non-admin cannot toggle the waiting room → 403', async () => {
        const { concertId, userId } = await seedBasic(ds);
        const res = await request(app)
            .patch(`/api/v1/concerts/${concertId}/queue/gating`)
            .set(...bearer(userId))
            .send({ gatedOnSale: true });
        expect(res.status).toBe(403);
    });

    it('gating: an admin turns the waiting room on, and /reserves becomes gated', async () => {
        const { concertId, userId } = await seedBasic(ds);
        const res = await request(app)
            .patch(`/api/v1/concerts/${concertId}/queue/gating`)
            .set(...bearer(userId, 'admin'))
            .send({ gatedOnSale: true });
        expect(res.status).toBe(200);
        const blocked = await request(app)
            .post('/api/v1/reserves')
            .set(...bearer(userId))
            .send({ concertId, seats: ['A1'] });
        expect(blocked.status).toBe(403);
    });

    it('gated concert: /reserves is blocked (403) until you are admitted', async () => {
        const { concertId, userId } = await seedBasic(ds);
        await gate(concertId);
        const blocked = await request(app)
            .post('/api/v1/reserves')
            .set(...bearer(userId))
            .send({ concertId, seats: ['A1'] });
        expect(blocked.status).toBe(403);
        expect(blocked.body.error).toBe('QUEUE_NOT_ADMITTED');

        // join → admitted → now allowed
        await request(app)
            .post(`/api/v1/concerts/${concertId}/queue/join`)
            .set(...bearer(userId))
            .send();
        const allowed = await request(app)
            .post('/api/v1/reserves')
            .set(...bearer(userId))
            .send({ concertId, seats: ['A1'] });
        expect(allowed.status).toBe(201);
    });

    it('leave: 204, and afterwards /reserves is gated again (pass given up)', async () => {
        const { concertId, userId } = await seedBasic(ds);
        await gate(concertId);
        await request(app)
            .post(`/api/v1/concerts/${concertId}/queue/join`)
            .set(...bearer(userId))
            .send(); // admitted
        const left = await request(app)
            .post(`/api/v1/concerts/${concertId}/queue/leave`)
            .set(...bearer(userId))
            .send();
        expect(left.status).toBe(204);
        const blocked = await request(app)
            .post('/api/v1/reserves')
            .set(...bearer(userId))
            .send({ concertId, seats: ['A1'] });
        expect(blocked.status).toBe(403);
    });
});
