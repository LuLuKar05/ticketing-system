import { Client } from 'pg';

export const TEST_DATABASE_URL =
    process.env.TEST_DATABASE_URL ?? 'postgres://ticket:ticket@localhost:5433/ticketing_test';

/**
 * Jest globalSetup — runs once before the whole suite. Ensures the dedicated test database exists
 * and has the uuid-ossp extension (needed by the entities' `uuid_generate_v4()` id defaults). Each
 * test then connects with `dropSchema + synchronize`, so schema/data are rebuilt per test.
 */
export default async function globalSetup(): Promise<void> {
    const dbName = new URL(TEST_DATABASE_URL).pathname.slice(1);

    // Connect to the maintenance DB to CREATE DATABASE if it's missing.
    const adminUrl = new URL(TEST_DATABASE_URL);
    adminUrl.pathname = '/postgres';
    const admin = new Client({ connectionString: adminUrl.toString() });
    await admin.connect();
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (rowCount === 0) await admin.query(`CREATE DATABASE "${dbName}"`);
    await admin.end();

    // Extensions live in the public schema; dropSchema recreates public, so ensure it here once
    // and again inside the test DataSource is unnecessary — TypeORM's clearDatabase drops tables,
    // not extensions, so this survives per-test resets.
    const db = new Client({ connectionString: TEST_DATABASE_URL });
    await db.connect();
    await db.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    await db.end();
}
