import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestDataSource } from '../helpers/testDataSource';
import { buildTestContainer } from '../helpers/testContainer';
import { createApp } from '../../src/app';
import type { IConcertController } from '../../src/controllers/ConcertController';
import type { IReserveController } from '../../src/controllers/ReserveController';
import type { IOrderController } from '../../src/controllers/OrderController';
import type { ISeatController } from '../../src/controllers/SeatController';
import { beginShutdown, resetLifecycleForTests } from '../../src/lifecycle';

describe('GET /health (liveness probe for Docker/orchestrators)', () => {
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
        resetLifecycleForTests();
        await ds.destroy();
    });

    it('responds 200 with status ok and an uptime', async () => {
        const res = await request(app).get('/health');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('ok');
        expect(typeof res.body.uptime).toBe('number');
    });

    // Phase D: once draining, the probe must fail so a load balancer stops routing here BEFORE the
    // socket closes — in-flight requests still finish, new ones go to another instance.
    it('responds 503 shutting_down once a drain has begun', async () => {
        beginShutdown();
        const res = await request(app).get('/health');
        expect(res.status).toBe(503);
        expect(res.body.status).toBe('shutting_down');
    });
});
