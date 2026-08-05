import { DataSource } from 'typeorm';
import { InitialSchema1781737723635 } from '../../src/migrations/sqlite/1781737723635-InitialSchema';
import { HardHoldModel1783084797031 } from '../../src/migrations/sqlite/1783084797031-HardHoldModel';
import { AddSeatCatalog1784151985310 } from '../../src/migrations/sqlite/1784151985310-AddSeatCatalog';
import { DropTierQuantity1784192834660 } from '../../src/migrations/sqlite/1784192834660-DropTierQuantity';

describe('scratch: DropTierQuantity down() is revertible', () => {
    it('runs all migrations up, then reverts the last one with data present', async () => {
        const ds = new DataSource({
            type: 'better-sqlite3',
            database: ':memory:',
            migrations: [
                InitialSchema1781737723635,
                HardHoldModel1783084797031,
                AddSeatCatalog1784151985310,
                DropTierQuantity1784192834660,
            ],
            entities: [],
        });
        await ds.initialize();
        await ds.runMigrations();

        // Seed a concert + tier + 3 seats so the revert has real rows to restore.
        await ds.query(
            `INSERT INTO concert (id, name, concertDate, description, imageUrl, location, artist, genre, totalTickets, duration, ageRestriction, oneTicketPerUser, status)
             VALUES ('c1', 'C', datetime('now'), 'd', 'u', 'l', 'a', 'g', 10, 60, 0, 0, 'upcoming')`,
        );
        await ds.query(`INSERT INTO ticket_tier (id, name, price, concertId) VALUES ('t1', 'VIP', 1000, 'c1')`);
        for (const n of ['A1', 'A2', 'A3']) {
            await ds.query(
                `INSERT INTO seat (id, seatNumber, concertId, ticketTierId) VALUES ('s-${n}', '${n}', 'c1', 't1')`,
            );
        }

        // The bug: this used to throw NOT NULL constraint failed: ticket_tier.quantity
        await ds.undoLastMigration();

        const rows = await ds.query(`SELECT quantity FROM ticket_tier WHERE id = 't1'`);
        console.log('quantity after revert:', rows[0].quantity);
        expect(rows[0].quantity).toBe(3); // backfilled from COUNT(seat)

        await ds.destroy();
    });
});
