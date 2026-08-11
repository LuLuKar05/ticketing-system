import { DataSource } from 'typeorm';
import { User } from '../../src/entities/User';
import { Concert } from '../../src/entities/Concert';
import { Ticket } from '../../src/entities/Ticket';
import { Reserve } from '../../src/entities/Reserve';
import { TicketTier } from '../../src/entities/TicketTier';
import { Order } from '../../src/entities/Order';
import { Seat } from '../../src/entities/Seat';
import { Credential } from '../../src/entities/Credential';
import { TEST_DATABASE_URL } from './globalSetup';

/**
 * A per-test Postgres DataSource against the dedicated `ticketing_test` database (created by
 * globalSetup). `dropSchema + synchronize` rebuild the schema from the entity decorators — including
 * the partial/unique indexes — for each test, so exclusivity constraints and row locks are exercised
 * against the REAL engine. Production `src/data-source.ts` stays synchronize:false + migrations.
 */
export function createTestDataSource(): DataSource {
    return new DataSource({
        type: 'postgres',
        url: TEST_DATABASE_URL,
        synchronize: true,
        dropSchema: true,
        logging: false,
        entities: [User, Concert, Ticket, Reserve, TicketTier, Order, Seat, Credential],
    });
}
