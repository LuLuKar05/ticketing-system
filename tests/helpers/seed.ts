import { DataSource } from 'typeorm';
import { Concert } from '../../src/entities/Concert';
import { TicketTier } from '../../src/entities/TicketTier';
import { User } from '../../src/entities/User';
import { Seat } from '../../src/entities/Seat';

let seq = 0;
const uniq = () => `${Date.now()}-${seq++}`;

export async function seedConcert(ds: DataSource, overrides: Partial<Concert> = {}): Promise<Concert> {
    return ds.getRepository(Concert).save({
        name: 'Test Concert',
        // A future date so the sellable-guard (assertConcertSellable) treats it as open for sales.
        // Tests that need a past/cancelled concert override concertDate/status explicitly.
        concertDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        description: 'desc',
        imageUrl: 'http://x',
        location: 'Testville',
        artist: ['A'],
        genre: ['rock'],
        totalTickets: 100,
        duration: 120,
        ageRestriction: 0,
        oneTicketPerUser: false,
        ...overrides,
    } as Concert);
}

export async function seedTier(
    ds: DataSource,
    concertId: string,
    overrides: Partial<TicketTier> = {},
): Promise<TicketTier> {
    return ds.getRepository(TicketTier).save({
        name: 'General',
        price: 5000,
        concert: { id: concertId },
        ...overrides,
    } as TicketTier);
}

/**
 * Seed catalog seats for a concert/tier. Capacity is COUNT(seat), so tests that used to
 * rely on `quantity` now seed as many seats as they need to hold/sell.
 */
export async function seedSeatMap(
    ds: DataSource,
    concertId: string,
    tierId: string,
    seatNumbers: string[],
): Promise<Seat[]> {
    const rows = seatNumbers.map((seatNumber) => ({
        seatNumber,
        concert: { id: concertId },
        ticketTier: { id: tierId },
    }));
    return ds.getRepository(Seat).save(rows as Seat[]);
}

export async function seedUser(ds: DataSource, overrides: Partial<User> = {}): Promise<User> {
    return ds.getRepository(User).save({
        name: 'Test User',
        email: `user-${uniq()}@test.local`,
        password: 'hashed',
        phoneNumber: '0',
        address: 'here',
        dateOfBirth: new Date('1990-01-01'),
        ...overrides,
    } as User);
}

/**
 * Seed a concert + one tier + one user + a default catalog of seats; returns their ids.
 * The default catalog covers the seat numbers the hold/order tests reserve.
 */
export async function seedBasic(ds: DataSource, concertOverrides: Partial<Concert> = {}) {
    const concert = await seedConcert(ds, concertOverrides);
    const tier = await seedTier(ds, concert.id);
    const user = await seedUser(ds);
    await seedSeatMap(ds, concert.id, tier.id, ['A1', 'A2', 'A3', 'B1', 'S1', 'S2', 'C1']);
    return { concertId: concert.id, tierId: tier.id, userId: user.id };
}
