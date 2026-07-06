import { DataSource } from 'typeorm';
import { Concert } from '../../src/entities/Concert';
import { TicketTier } from '../../src/entities/TicketTier';
import { User } from '../../src/entities/User';

let seq = 0;
const uniq = () => `${Date.now()}-${seq++}`;

export async function seedConcert(ds: DataSource, overrides: Partial<Concert> = {}): Promise<Concert> {
    return ds.getRepository(Concert).save({
        name: 'Test Concert',
        concertDate: new Date(),
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

export async function seedTier(ds: DataSource, concertId: string, overrides: Partial<TicketTier> = {}): Promise<TicketTier> {
    return ds.getRepository(TicketTier).save({
        name: 'General',
        price: 5000,
        quantity: 100,
        concert: { id: concertId },
        ...overrides,
    } as TicketTier);
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

/** Seed a concert + one tier + one user; returns their ids. */
export async function seedBasic(ds: DataSource, concertOverrides: Partial<Concert> = {}) {
    const concert = await seedConcert(ds, concertOverrides);
    const tier = await seedTier(ds, concert.id);
    const user = await seedUser(ds);
    return { concertId: concert.id, tierId: tier.id, userId: user.id };
}
