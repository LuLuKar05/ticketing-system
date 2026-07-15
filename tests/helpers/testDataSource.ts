import { DataSource } from 'typeorm';
import { User } from '../../src/entities/User';
import { Concert } from '../../src/entities/Concert';
import { Ticket } from '../../src/entities/Ticket';
import { Reserve } from '../../src/entities/Reserve';
import { TicketTier } from '../../src/entities/TicketTier';
import { Order } from '../../src/entities/Order';
import { Seat } from '../../src/entities/Seat';

/**
 * A throwaway in-memory SQLite DataSource for tests. `synchronize: true` builds the schema
 * directly from the entity decorators (including the partial/unique indexes), so exclusivity
 * constraints are genuinely exercised. Production `src/data-source.ts` stays synchronize:false.
 */
export function createTestDataSource(): DataSource {
    return new DataSource({
        type: 'better-sqlite3',
        database: ':memory:',
        synchronize: true,
        dropSchema: true,
        logging: false,
        entities: [User, Concert, Ticket, Reserve, TicketTier, Order, Seat],
    });
}
