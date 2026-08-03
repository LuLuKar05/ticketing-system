import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestDataSource } from '../helpers/testDataSource';
import { buildTestContainer } from '../helpers/testContainer';
import { createApp } from '../../src/app';
import type { IConcertController } from '../../src/controllers/ConcertController';
import type { IReserveController } from '../../src/controllers/ReserveController';
import type { IOrderController } from '../../src/controllers/OrderController';
import type { ISeatController } from '../../src/controllers/SeatController';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('Correlation-ID middleware', () => {
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

    it('echoes a caller-supplied X-Correlation-ID back on the response', async () => {
        const res = await request(app).get('/health').set('X-Correlation-ID', 'trace-abc-123');
        expect(res.headers['x-correlation-id']).toBe('trace-abc-123');
    });

    it('generates a UUID correlation id when none is supplied', async () => {
        const res = await request(app).get('/health');
        expect(res.headers['x-correlation-id']).toMatch(UUID_RE);
    });

    it('generates one when the header is present but blank', async () => {
        const res = await request(app).get('/health').set('X-Correlation-ID', '   ');
        expect(res.headers['x-correlation-id']).toMatch(UUID_RE);
    });
});
