import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSeatCatalog1784151985310 implements MigrationInterface {
    name = 'AddSeatCatalog1784151985310'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "seat" ("id" varchar PRIMARY KEY NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "seatNumber" text NOT NULL, "section" text, "rowLabel" text, "concertId" varchar, "ticketTierId" varchar, CONSTRAINT "Uq_seat_concert_seatNumber" UNIQUE ("concertId", "seatNumber"))`);
        await queryRunner.query(`CREATE INDEX "Idx_seat_concert_tier" ON "seat" ("concertId", "ticketTierId") `);
        await queryRunner.query(`DROP INDEX "Idx_concert_location"`);
        await queryRunner.query(`DROP INDEX "Idx_sorted_concert_status"`);
        await queryRunner.query(`DROP INDEX "Idx_concert_date"`);
        await queryRunner.query(`CREATE TABLE "temporary_concert" ("id" varchar PRIMARY KEY NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "name" varchar NOT NULL, "concertDate" datetime NOT NULL, "description" text(1000) NOT NULL, "imageUrl" varchar NOT NULL, "location" varchar NOT NULL, "artist" text NOT NULL, "genre" text NOT NULL, "totalTickets" integer NOT NULL, "duration" integer NOT NULL, "ageRestriction" integer NOT NULL, "oneTicketPerUser" boolean NOT NULL DEFAULT (0), "status" text NOT NULL DEFAULT ('upcoming'), "hasAssignedSeating" boolean NOT NULL DEFAULT (1))`);
        await queryRunner.query(`INSERT INTO "temporary_concert"("id", "createdAt", "updatedAt", "name", "concertDate", "description", "imageUrl", "location", "artist", "genre", "totalTickets", "duration", "ageRestriction", "oneTicketPerUser", "status") SELECT "id", "createdAt", "updatedAt", "name", "concertDate", "description", "imageUrl", "location", "artist", "genre", "totalTickets", "duration", "ageRestriction", "oneTicketPerUser", "status" FROM "concert"`);
        await queryRunner.query(`DROP TABLE "concert"`);
        await queryRunner.query(`ALTER TABLE "temporary_concert" RENAME TO "concert"`);
        await queryRunner.query(`CREATE INDEX "Idx_concert_location" ON "concert" ("location") `);
        await queryRunner.query(`CREATE INDEX "Idx_sorted_concert_status" ON "concert" ("status", "concertDate") `);
        await queryRunner.query(`CREATE INDEX "Idx_concert_date" ON "concert" ("concertDate") `);
        await queryRunner.query(`DROP INDEX "Idx_seat_concert_tier"`);
        await queryRunner.query(`CREATE TABLE "temporary_seat" ("id" varchar PRIMARY KEY NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "seatNumber" text NOT NULL, "section" text, "rowLabel" text, "concertId" varchar, "ticketTierId" varchar, CONSTRAINT "Uq_seat_concert_seatNumber" UNIQUE ("concertId", "seatNumber"), CONSTRAINT "FK_570eb4227fc33ce79013c871bd7" FOREIGN KEY ("concertId") REFERENCES "concert" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION, CONSTRAINT "FK_f3d9512d4eba9c48d839a5cadd3" FOREIGN KEY ("ticketTierId") REFERENCES "ticket_tier" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION)`);
        await queryRunner.query(`INSERT INTO "temporary_seat"("id", "createdAt", "updatedAt", "seatNumber", "section", "rowLabel", "concertId", "ticketTierId") SELECT "id", "createdAt", "updatedAt", "seatNumber", "section", "rowLabel", "concertId", "ticketTierId" FROM "seat"`);
        await queryRunner.query(`DROP TABLE "seat"`);
        await queryRunner.query(`ALTER TABLE "temporary_seat" RENAME TO "seat"`);
        await queryRunner.query(`CREATE INDEX "Idx_seat_concert_tier" ON "seat" ("concertId", "ticketTierId") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "Idx_seat_concert_tier"`);
        await queryRunner.query(`ALTER TABLE "seat" RENAME TO "temporary_seat"`);
        await queryRunner.query(`CREATE TABLE "seat" ("id" varchar PRIMARY KEY NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "seatNumber" text NOT NULL, "section" text, "rowLabel" text, "concertId" varchar, "ticketTierId" varchar, CONSTRAINT "Uq_seat_concert_seatNumber" UNIQUE ("concertId", "seatNumber"))`);
        await queryRunner.query(`INSERT INTO "seat"("id", "createdAt", "updatedAt", "seatNumber", "section", "rowLabel", "concertId", "ticketTierId") SELECT "id", "createdAt", "updatedAt", "seatNumber", "section", "rowLabel", "concertId", "ticketTierId" FROM "temporary_seat"`);
        await queryRunner.query(`DROP TABLE "temporary_seat"`);
        await queryRunner.query(`CREATE INDEX "Idx_seat_concert_tier" ON "seat" ("concertId", "ticketTierId") `);
        await queryRunner.query(`DROP INDEX "Idx_concert_date"`);
        await queryRunner.query(`DROP INDEX "Idx_sorted_concert_status"`);
        await queryRunner.query(`DROP INDEX "Idx_concert_location"`);
        await queryRunner.query(`ALTER TABLE "concert" RENAME TO "temporary_concert"`);
        await queryRunner.query(`CREATE TABLE "concert" ("id" varchar PRIMARY KEY NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "name" varchar NOT NULL, "concertDate" datetime NOT NULL, "description" text(1000) NOT NULL, "imageUrl" varchar NOT NULL, "location" varchar NOT NULL, "artist" text NOT NULL, "genre" text NOT NULL, "totalTickets" integer NOT NULL, "duration" integer NOT NULL, "ageRestriction" integer NOT NULL, "oneTicketPerUser" boolean NOT NULL DEFAULT (0), "status" text NOT NULL DEFAULT ('upcoming'))`);
        await queryRunner.query(`INSERT INTO "concert"("id", "createdAt", "updatedAt", "name", "concertDate", "description", "imageUrl", "location", "artist", "genre", "totalTickets", "duration", "ageRestriction", "oneTicketPerUser", "status") SELECT "id", "createdAt", "updatedAt", "name", "concertDate", "description", "imageUrl", "location", "artist", "genre", "totalTickets", "duration", "ageRestriction", "oneTicketPerUser", "status" FROM "temporary_concert"`);
        await queryRunner.query(`DROP TABLE "temporary_concert"`);
        await queryRunner.query(`CREATE INDEX "Idx_concert_date" ON "concert" ("concertDate") `);
        await queryRunner.query(`CREATE INDEX "Idx_sorted_concert_status" ON "concert" ("status", "concertDate") `);
        await queryRunner.query(`CREATE INDEX "Idx_concert_location" ON "concert" ("location") `);
        await queryRunner.query(`DROP INDEX "Idx_seat_concert_tier"`);
        await queryRunner.query(`DROP TABLE "seat"`);
    }

}
