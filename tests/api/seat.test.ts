import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestDataSource } from '../helpers/testDataSource';
import { buildTestContainer } from '../helpers/testContainer';
import { seedConcert, seedTier, seedUser } from '../helpers/seed';
import { createApp } from '../../src/app';
import type { IConcertController } from '../../src/controllers/ConcertController';
import type { IReserveController } from '../../src/controllers/ReserveController';
import type { IOrderController } from '../../src/controllers/OrderController';
import type { ISeatController } from '../../src/controllers/SeatController';
import { Ticket, TicketStatus } from '../../src/entities/Ticket';
import { Seat } from '../../src/entities/Seat';

const MISSING_UUID = '00000000-0000-0000-0000-000000000000';

describe('POST /api/v1/concerts/:id/seats — seat map import (API)', () => {
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

    it('201 imports the layout and stores the rows', async () => {
        const concert = await seedConcert(ds);
        await seedTier(ds, concert.id, { name: 'VIP', price: 15000 });
        await seedTier(ds, concert.id, { name: 'General', price: 5000 });
        const res = await request(app).post(`/api/v1/concerts/${concert.id}/seats`).send({
            seats: [
                { seatNumber: 'A1', section: 'A', row: '1', tierName: 'VIP' },
                { seatNumber: 'A2', section: 'A', row: '1', tierName: 'VIP' },
                { seatNumber: 'B1', section: 'B', row: '1', tierName: 'General' },
            ],
        });
        expect(res.status).toBe(201);
        expect(res.body.data.inserted).toBe(3);
        expect(await ds.getRepository(Seat).count({ where: { concert: { id: concert.id } } })).toBe(3);
    });

    it('400 for an unknown tierName', async () => {
        const concert = await seedConcert(ds);
        await seedTier(ds, concert.id, { name: 'VIP', price: 15000 });
        const res = await request(app).post(`/api/v1/concerts/${concert.id}/seats`).send({
            seats: [{ seatNumber: 'A1', tierName: 'DoesNotExist' }],
        });
        expect(res.status).toBe(400);
    });

    it('400 for duplicate seatNumbers', async () => {
        const concert = await seedConcert(ds);
        await seedTier(ds, concert.id, { name: 'VIP', price: 15000 });
        const res = await request(app).post(`/api/v1/concerts/${concert.id}/seats`).send({
            seats: [{ seatNumber: 'A1', tierName: 'VIP' }, { seatNumber: 'A1', tierName: 'VIP' }],
        });
        expect(res.status).toBe(400);
    });

    it('409 when the concert already has a sold seat (can\'t repave mid-sale)', async () => {
        const concert = await seedConcert(ds);
        const vip = await seedTier(ds, concert.id, { name: 'VIP', price: 15000 });
        const user = await seedUser(ds);
        await ds.getRepository(Ticket).save({
            seatNumber: 'A1', status: TicketStatus.SOLD, pricePaid: 15000,
            concert: { id: concert.id }, ticketTier: { id: vip.id }, user: { id: user.id },
        } as Ticket);
        const res = await request(app).post(`/api/v1/concerts/${concert.id}/seats`).send({
            seats: [{ seatNumber: 'B1', tierName: 'VIP' }],
        });
        expect(res.status).toBe(409);
    });

    it('409 when a seat is currently HELD (can\'t repave mid-hold)', async () => {
        const concert = await seedConcert(ds);
        await seedTier(ds, concert.id, { name: 'VIP', price: 15000 });
        const user = await seedUser(ds);
        await request(app).post(`/api/v1/concerts/${concert.id}/seats`).send({
            seats: [{ seatNumber: 'A1', tierName: 'VIP' }],
        });
        // hold A1 — now a re-import must be rejected
        await request(app).post('/api/v1/reserves').send({ userId: user.id, concertId: concert.id, seats: ['A1'] });
        const res = await request(app).post(`/api/v1/concerts/${concert.id}/seats`).send({
            seats: [{ seatNumber: 'B1', tierName: 'VIP' }],
        });
        expect(res.status).toBe(409);
    });

    it('404 for a missing concert', async () => {
        const res = await request(app).post(`/api/v1/concerts/${MISSING_UUID}/seats`).send({
            seats: [{ seatNumber: 'A1', tierName: 'VIP' }],
        });
        expect(res.status).toBe(404);
    });

    describe('GET /concerts/:id/seats (read model)', () => {
        it('returns every seat as available on a fresh map', async () => {
            const concert = await seedConcert(ds);
            await seedTier(ds, concert.id, { name: 'VIP', price: 15000 });
            await request(app).post(`/api/v1/concerts/${concert.id}/seats`).send({
                seats: [{ seatNumber: 'A1', tierName: 'VIP' }, { seatNumber: 'A2', tierName: 'VIP' }],
            });
            const res = await request(app).get(`/api/v1/concerts/${concert.id}/seats`);
            expect(res.status).toBe(200);
            expect(res.body.data.seats).toHaveLength(2);
            expect(res.body.data.seats.every((s: { status: string }) => s.status === 'available')).toBe(true);
            expect(res.body.data.seats[0].tier.price).toBe(15000);
        });

        it('shows a held seat as held', async () => {
            const concert = await seedConcert(ds);
            const vip = await seedTier(ds, concert.id, { name: 'VIP', price: 15000 });
            const user = await seedUser(ds);
            await request(app).post(`/api/v1/concerts/${concert.id}/seats`).send({
                seats: [{ seatNumber: 'A1', tierName: 'VIP' }, { seatNumber: 'A2', tierName: 'VIP' }],
            });
            await request(app).post('/api/v1/reserves').send({
                userId: user.id, concertId: concert.id, seats: ['A1'],
            });
            const res = await request(app).get(`/api/v1/concerts/${concert.id}/seats`);
            const byNum = Object.fromEntries(res.body.data.seats.map((s: { seatNumber: string; status: string }) => [s.seatNumber, s.status]));
            expect(byNum['A1']).toBe('held');
            expect(byNum['A2']).toBe('available');
        });

        it('shows a sold seat as sold', async () => {
            const concert = await seedConcert(ds);
            const vip = await seedTier(ds, concert.id, { name: 'VIP', price: 15000 });
            const user = await seedUser(ds);
            await request(app).post(`/api/v1/concerts/${concert.id}/seats`).send({ seats: [{ seatNumber: 'A1', tierName: 'VIP' }] });
            await ds.getRepository(Ticket).save({
                seatNumber: 'A1', status: TicketStatus.SOLD, pricePaid: 15000,
                concert: { id: concert.id }, ticketTier: { id: vip.id }, user: { id: user.id },
            } as Ticket);
            const res = await request(app).get(`/api/v1/concerts/${concert.id}/seats`);
            expect(res.body.data.seats.find((s: { seatNumber: string }) => s.seatNumber === 'A1').status).toBe('sold');
        });

        it('404 for a missing concert', async () => {
            const res = await request(app).get(`/api/v1/concerts/${MISSING_UUID}/seats`);
            expect(res.status).toBe(404);
        });
    });
});
