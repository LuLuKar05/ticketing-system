/**
 * Bootstrap data for trying the seat-map endpoints by hand.
 *
 * There is (deliberately) no HTTP route to create a concert or its tiers yet, and the seat-map
 * import references tiers by `tierName` — so those must exist first. This script inserts a concert,
 * two tiers (VIP / General) and a user into the SAME Postgres database the server uses (DATABASE_URL),
 * then prints the ids you need for the curl/PowerShell examples.
 *
 * Run:   npx ts-node --transpile-only src/scripts/seedForSeatMap.ts
 *        (--transpile-only because src/scripts is excluded from tsconfig, so type info is skipped)
 * Then:  npm start   (server on http://localhost:3000)  and fire the requests below.
 */
import 'reflect-metadata';
import { AppDataSource } from '../data-source';
import { Concert } from '../entities/Concert';
import { TicketTier } from '../entities/TicketTier';
import { User } from '../entities/User';

async function main() {
    await AppDataSource.initialize();

    const concert = await AppDataSource.getRepository(Concert).save({
        name: 'Seat-map Demo Concert',
        concertDate: new Date('2026-12-01T20:00:00Z'),
        description: 'Demo for trying the seat-map import endpoint',
        imageUrl: 'http://example.com/poster.jpg',
        location: 'Demo Arena',
        artist: ['Demo Artist'],
        genre: ['rock'],
        totalTickets: 100,
        duration: 120,
        ageRestriction: 0,
        oneTicketPerUser: false,
    } as Concert);

    await AppDataSource.getRepository(TicketTier).save([
        { name: 'VIP', price: 15000, concert: { id: concert.id } },
        { name: 'General', price: 5000, concert: { id: concert.id } },
    ] as TicketTier[]);

    const user = await AppDataSource.getRepository(User).save({
        name: 'Demo User',
        email: `demo-${Date.now()}@test.local`,
        password: 'hashed',
        phoneNumber: '0',
        address: 'here',
        dateOfBirth: new Date('1990-01-01'),
    } as User);

    console.log('\n=== Seed complete — use these ids ===');
    console.log('CONCERT_ID =', concert.id);
    console.log('USER_ID    =', user.id);
    console.log('Tiers      = VIP (15000), General (5000)\n');

    await AppDataSource.destroy();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
