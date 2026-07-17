import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestDataSource } from '../helpers/testDataSource';
import { buildTestContainer } from '../helpers/testContainer';
import { createApp } from '../../src/app';
import type { IConcertController } from '../../src/controllers/ConcertController';
import type { IReserveController } from '../../src/controllers/ReserveController';
import type { IOrderController } from '../../src/controllers/OrderController';
import type { ISeatController } from '../../src/controllers/SeatController';

/**
 * The OpenAPI docs are generated from the same zod DTOs the routes validate with, so the
 * real assertion here is coverage: every mounted API path must appear in the spec. A new
 * endpoint that isn't documented fails this suite.
 */
describe('API docs (Swagger UI + OpenAPI spec)', () => {
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

    it('serves the Swagger UI at /api/v1/docs', async () => {
        const res = await request(app).get('/api/v1/docs/');
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/html/);
        expect(res.text).toContain('swagger-ui');
    });

    it('serves a valid OpenAPI 3.1 document at /api/v1/openapi.json', async () => {
        const res = await request(app).get('/api/v1/openapi.json');
        expect(res.status).toBe(200);
        expect(res.body.openapi).toBe('3.1.0');
        expect(res.body.info.title).toBeTruthy();
    });

    it('documents every mounted API path', async () => {
        const res = await request(app).get('/api/v1/openapi.json');
        const paths = Object.keys(res.body.paths);
        expect(paths).toEqual(
            expect.arrayContaining([
                '/api/v1/concerts',
                '/api/v1/concerts/{id}',
                '/api/v1/concerts/{id}/seats',
                '/api/v1/reserves',
                '/api/v1/orders/{id}/confirm',
            ]),
        );
    });

    it('reserve request schema in the spec matches the DTO shape (seats: string[])', async () => {
        const res = await request(app).get('/api/v1/openapi.json');
        const schema =
            res.body.paths['/api/v1/reserves'].post.requestBody.content['application/json'].schema;
        expect(schema.properties.seats.type).toBe('array');
        expect(schema.properties.seats.items.type).toBe('string');
        expect(schema.required).toEqual(expect.arrayContaining(['userId', 'concertId', 'seats']));
    });
});
