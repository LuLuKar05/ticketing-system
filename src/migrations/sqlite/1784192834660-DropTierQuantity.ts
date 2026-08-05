import { MigrationInterface, QueryRunner } from "typeorm";

export class DropTierQuantity1784192834660 implements MigrationInterface {
    name = 'DropTierQuantity1784192834660'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "Idx_ticket_tier_quantity"`);
        await queryRunner.query(`DROP INDEX "Idx_ticket_tier_price"`);
        await queryRunner.query(`CREATE TABLE "temporary_ticket_tier" ("id" varchar PRIMARY KEY NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "name" text NOT NULL, "price" integer NOT NULL, "concertId" varchar, CONSTRAINT "Uq_ticket_tier_concert_name" UNIQUE ("concertId", "name"), CONSTRAINT "FK_a73fe6d048dd02c9e9a70ed838f" FOREIGN KEY ("concertId") REFERENCES "concert" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION)`);
        await queryRunner.query(`INSERT INTO "temporary_ticket_tier"("id", "createdAt", "updatedAt", "name", "price", "concertId") SELECT "id", "createdAt", "updatedAt", "name", "price", "concertId" FROM "ticket_tier"`);
        await queryRunner.query(`DROP TABLE "ticket_tier"`);
        await queryRunner.query(`ALTER TABLE "temporary_ticket_tier" RENAME TO "ticket_tier"`);
        await queryRunner.query(`CREATE INDEX "Idx_ticket_tier_price" ON "ticket_tier" ("price") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Hand-written (the generated down() was doubly broken: NOT NULL quantity with no
        // default made the INSERT…SELECT fail, and the rename-and-rebuild pattern trips the
        // seat table's FK to ticket_tier once seats exist — SQLite FKs follow table renames).
        // ADD COLUMN needs no rebuild; NOT NULL needs a DEFAULT; then backfill the real value
        // from the seat catalog (capacity = COUNT(seat) per tier).
        await queryRunner.query(`ALTER TABLE "ticket_tier" ADD COLUMN "quantity" integer NOT NULL DEFAULT (0)`);
        await queryRunner.query(`UPDATE "ticket_tier" SET "quantity" = (SELECT COUNT(*) FROM "seat" WHERE "seat"."ticketTierId" = "ticket_tier"."id")`);
        await queryRunner.query(`CREATE INDEX "Idx_ticket_tier_quantity" ON "ticket_tier" ("quantity") `);
    }

}
