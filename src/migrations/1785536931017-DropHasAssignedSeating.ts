import { MigrationInterface, QueryRunner } from "typeorm";

export class DropHasAssignedSeating1785536931017 implements MigrationInterface {
    name = 'DropHasAssignedSeating1785536931017'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "Idx_concert_date"`);
        await queryRunner.query(`DROP INDEX "Idx_sorted_concert_status"`);
        await queryRunner.query(`DROP INDEX "Idx_concert_location"`);
        await queryRunner.query(`CREATE TABLE "temporary_concert" ("id" varchar PRIMARY KEY NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "name" varchar NOT NULL, "concertDate" datetime NOT NULL, "description" text(1000) NOT NULL, "imageUrl" varchar NOT NULL, "location" varchar NOT NULL, "artist" text NOT NULL, "genre" text NOT NULL, "totalTickets" integer NOT NULL, "duration" integer NOT NULL, "ageRestriction" integer NOT NULL, "oneTicketPerUser" boolean NOT NULL DEFAULT (0), "status" text NOT NULL DEFAULT ('upcoming'))`);
        await queryRunner.query(`INSERT INTO "temporary_concert"("id", "createdAt", "updatedAt", "name", "concertDate", "description", "imageUrl", "location", "artist", "genre", "totalTickets", "duration", "ageRestriction", "oneTicketPerUser", "status") SELECT "id", "createdAt", "updatedAt", "name", "concertDate", "description", "imageUrl", "location", "artist", "genre", "totalTickets", "duration", "ageRestriction", "oneTicketPerUser", "status" FROM "concert"`);
        await queryRunner.query(`DROP TABLE "concert"`);
        await queryRunner.query(`ALTER TABLE "temporary_concert" RENAME TO "concert"`);
        await queryRunner.query(`CREATE INDEX "Idx_concert_date" ON "concert" ("concertDate") `);
        await queryRunner.query(`CREATE INDEX "Idx_sorted_concert_status" ON "concert" ("status", "concertDate") `);
        await queryRunner.query(`CREATE INDEX "Idx_concert_location" ON "concert" ("location") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "Idx_concert_location"`);
        await queryRunner.query(`DROP INDEX "Idx_sorted_concert_status"`);
        await queryRunner.query(`DROP INDEX "Idx_concert_date"`);
        await queryRunner.query(`ALTER TABLE "concert" RENAME TO "temporary_concert"`);
        await queryRunner.query(`CREATE TABLE "concert" ("id" varchar PRIMARY KEY NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "name" varchar NOT NULL, "concertDate" datetime NOT NULL, "description" text(1000) NOT NULL, "imageUrl" varchar NOT NULL, "location" varchar NOT NULL, "artist" text NOT NULL, "genre" text NOT NULL, "totalTickets" integer NOT NULL, "duration" integer NOT NULL, "ageRestriction" integer NOT NULL, "oneTicketPerUser" boolean NOT NULL DEFAULT (0), "status" text NOT NULL DEFAULT ('upcoming'), "hasAssignedSeating" boolean NOT NULL DEFAULT (1))`);
        await queryRunner.query(`INSERT INTO "concert"("id", "createdAt", "updatedAt", "name", "concertDate", "description", "imageUrl", "location", "artist", "genre", "totalTickets", "duration", "ageRestriction", "oneTicketPerUser", "status") SELECT "id", "createdAt", "updatedAt", "name", "concertDate", "description", "imageUrl", "location", "artist", "genre", "totalTickets", "duration", "ageRestriction", "oneTicketPerUser", "status" FROM "temporary_concert"`);
        await queryRunner.query(`DROP TABLE "temporary_concert"`);
        await queryRunner.query(`CREATE INDEX "Idx_concert_location" ON "concert" ("location") `);
        await queryRunner.query(`CREATE INDEX "Idx_sorted_concert_status" ON "concert" ("status", "concertDate") `);
        await queryRunner.query(`CREATE INDEX "Idx_concert_date" ON "concert" ("concertDate") `);
    }

}
