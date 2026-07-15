import { DataSource } from 'typeorm';
import { createTestDataSource } from '../helpers/testDataSource';
import { buildTestContainer } from '../helpers/testContainer';
import { seedConcert, seedTier } from '../helpers/seed';
import type { ISeatRepository } from '../../src/repositories/SeatRepository';

describe('SeatRepository (integration)', () => {
    let ds: DataSource;
    let repo: ISeatRepository;

    beforeEach(async () => {
        ds = createTestDataSource();
        await ds.initialize();
        repo = buildTestContainer(ds).resolve<ISeatRepository>('ISeatRepository');
    });
    afterEach(async () => {
        await ds.destroy();
    });

    it('replaceSeats inserts the catalog; findSeatsForConcert returns them with tiers', async () => {
        const concert = await seedConcert(ds);
        const vip = await seedTier(ds, concert.id, { name: 'VIP', price: 15000 });
        const gen = await seedTier(ds, concert.id, { name: 'General', price: 5000 });
        await repo.replaceSeats(concert.id, [
            { seatNumber: 'A1', section: 'A', rowLabel: '1', tierId: vip.id },
            { seatNumber: 'A2', section: 'A', rowLabel: '1', tierId: vip.id },
            { seatNumber: 'B1', section: 'B', rowLabel: '1', tierId: gen.id },
        ]);
        const seats = await repo.findSeatsForConcert(concert.id);
        expect(seats).toHaveLength(3);
        expect(seats[0].ticketTier).toBeDefined();
    });

    it('findSeatsByNumbers returns only the requested seats (with tier), skipping unknown ones', async () => {
        const concert = await seedConcert(ds);
        const vip = await seedTier(ds, concert.id, { name: 'VIP', price: 15000 });
        await repo.replaceSeats(concert.id, [
            { seatNumber: 'A1', tierId: vip.id },
            { seatNumber: 'A2', tierId: vip.id },
        ]);
        const found = await repo.findSeatsByNumbers(concert.id, ['A1', 'ZZZ-9999']);
        expect(found).toHaveLength(1);
        expect(found[0].seatNumber).toBe('A1');
        expect(found[0].ticketTier.price).toBe(15000);
    });

    it('replaceSeats is a full replace (overwrites the previous layout)', async () => {
        const concert = await seedConcert(ds);
        const vip = await seedTier(ds, concert.id, { name: 'VIP', price: 15000 });
        await repo.replaceSeats(concert.id, [{ seatNumber: 'A1', tierId: vip.id }, { seatNumber: 'A2', tierId: vip.id }]);
        await repo.replaceSeats(concert.id, [{ seatNumber: 'C1', tierId: vip.id }]);
        const seats = await repo.findSeatsForConcert(concert.id);
        expect(seats.map((s) => s.seatNumber)).toEqual(['C1']);
    });

    it('countSeatsByTier returns per-tier capacity (= seat count)', async () => {
        const concert = await seedConcert(ds);
        const vip = await seedTier(ds, concert.id, { name: 'VIP', price: 15000 });
        const gen = await seedTier(ds, concert.id, { name: 'General', price: 5000 });
        await repo.replaceSeats(concert.id, [
            { seatNumber: 'A1', tierId: vip.id },
            { seatNumber: 'A2', tierId: vip.id },
            { seatNumber: 'B1', tierId: gen.id },
        ]);
        const counts = await repo.countSeatsByTier(concert.id);
        expect(counts.find((c) => c.tierId === vip.id)?.count).toBe(2);
        expect(counts.find((c) => c.tierId === gen.id)?.count).toBe(1);
    });
});
