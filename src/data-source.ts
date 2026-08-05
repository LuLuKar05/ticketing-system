import { DataSource } from 'typeorm';
import { User } from './entities/User';
import { Concert } from './entities/Concert';
import { Ticket } from './entities/Ticket';
import { Reserve } from './entities/Reserve';
import { TicketTier } from './entities/TicketTier';
import { Order } from './entities/Order';
import { Seat } from './entities/Seat';

/**
 * Postgres is the single database engine across every environment (dev = test = prod) so the
 * concurrency guarantees the code relies on — row locks, SELECT FOR UPDATE, real transaction
 * isolation — are the same ones exercised by the tests. There is no SQLite fallback: shipping on a
 * different engine than we test on would defeat the point.
 *
 * `DATABASE_URL` is required (12-factor: config from the environment). We fail fast rather than
 * silently defaulting to a URL, which could point production at the wrong database.
 */
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
    throw new Error(
        'DATABASE_URL is required (e.g. postgres://user:pass@host:5432/ticketing). ' +
            'See .env.example. This app runs on Postgres only.',
    );
}

export const AppDataSource = new DataSource({
    type: 'postgres',
    url: databaseUrl,
    synchronize: false,
    // Per-query logging is a dev tool — opt in via env so containers/prod aren't spammed.
    logging: process.env.DB_LOGGING === 'true',
    entities: [User, Concert, Ticket, Reserve, TicketTier, Order, Seat],
    migrations: ['dist/migrations/pg/**/*.js'],
    subscribers: [],
});
