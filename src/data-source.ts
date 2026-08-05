import { DataSource, DataSourceOptions } from 'typeorm';
import { User } from './entities/User';
import { Concert } from './entities/Concert';
import { Ticket } from './entities/Ticket';
import { Reserve } from './entities/Reserve';
import { TicketTier } from './entities/TicketTier';
import { Order } from './entities/Order';
import { Seat } from './entities/Seat';

/**
 * DataSource is dialect-configurable:
 *  - `DATABASE_URL` set  → **Postgres** (production / real concurrency: row locks, SELECT FOR UPDATE).
 *  - otherwise           → **SQLite** (better-sqlite3) — the fast local/dev default.
 *
 * Migrations live in per-dialect folders (SQLite's temp-table rebuilds don't run on Postgres and
 * vice-versa), so the glob is picked to match the active driver.
 */
const entities = [User, Concert, Ticket, Reserve, TicketTier, Order, Seat];
const common = {
    synchronize: false,
    // Per-query logging is a dev tool — opt in via env so containers/prod aren't spammed.
    logging: process.env.DB_LOGGING === 'true',
    entities,
    subscribers: [],
};

const databaseUrl = process.env.DATABASE_URL;

const options: DataSourceOptions = databaseUrl
    ? {
          type: 'postgres',
          url: databaseUrl,
          migrations: ['dist/migrations/pg/**/*.js'],
          ...common,
      }
    : {
          type: 'better-sqlite3',
          database: './db/db.sqlite',
          migrations: ['dist/migrations/sqlite/**/*.js'],
          ...common,
      };

export const AppDataSource = new DataSource(options);
