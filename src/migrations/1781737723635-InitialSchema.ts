import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialSchema1781737723635 implements MigrationInterface {
    name = 'InitialSchema1781737723635'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "ticket_tier" ("id" varchar PRIMARY KEY NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "name" text NOT NULL, "price" integer NOT NULL, "quantity" integer NOT NULL, "concertId" varchar, CONSTRAINT "Uq_ticket_tier_concert_name" UNIQUE ("concertId", "name"))`);
        await queryRunner.query(`CREATE INDEX "Idx_ticket_tier_quantity" ON "ticket_tier" ("quantity") `);
        await queryRunner.query(`CREATE INDEX "Idx_ticket_tier_price" ON "ticket_tier" ("price") `);
        await queryRunner.query(`CREATE TABLE "concert" ("id" varchar PRIMARY KEY NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "name" varchar NOT NULL, "concertDate" datetime NOT NULL, "description" text(1000) NOT NULL, "imageUrl" varchar NOT NULL, "location" varchar NOT NULL, "artist" text NOT NULL, "genre" text NOT NULL, "totalTickets" integer NOT NULL, "duration" integer NOT NULL, "ageRestriction" integer NOT NULL, "oneTicketPerUser" boolean NOT NULL DEFAULT (0), "status" text NOT NULL DEFAULT ('upcoming'))`);
        await queryRunner.query(`CREATE INDEX "Idx_concert_date" ON "concert" ("concertDate") `);
        await queryRunner.query(`CREATE INDEX "Idx_sorted_concert_status" ON "concert" ("status", "concertDate") `);
        await queryRunner.query(`CREATE INDEX "Idx_concert_location" ON "concert" ("location") `);
        await queryRunner.query(`CREATE TABLE "reserve" ("id" varchar PRIMARY KEY NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "status" text NOT NULL DEFAULT ('pending'), "expiresAt" datetime NOT NULL, "userId" varchar, "ticketId" varchar)`);
        await queryRunner.query(`CREATE INDEX "Idx_reserve_ticket_id" ON "reserve" ("ticketId") `);
        await queryRunner.query(`CREATE INDEX "Idx_reserve_user_ticket" ON "reserve" ("userId", "ticketId") WHERE status = 'pending'`);
        await queryRunner.query(`CREATE INDEX "Idx_reserve_status" ON "reserve" ("status", "expiresAt") WHERE status = 'pending'`);
        await queryRunner.query(`CREATE TABLE "ticket" ("id" varchar PRIMARY KEY NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "seatNumber" integer NOT NULL, "status" text NOT NULL DEFAULT ('available'), "pricePaid" integer, "concertId" varchar, "userId" varchar, "ticketTierId" varchar, CONSTRAINT "Uq_ticket_concert_seat" UNIQUE ("concertId", "seatNumber"))`);
        await queryRunner.query(`CREATE INDEX "Idx_ticket_user_id" ON "ticket" ("userId") `);
        await queryRunner.query(`CREATE INDEX "Idx_sold_tickets" ON "ticket" ("status", "concertId", "ticketTierId") WHERE status = 'sold'`);
        await queryRunner.query(`CREATE INDEX "Idx_ticket_concert_user" ON "ticket" ("concertId", "userId") `);
        await queryRunner.query(`CREATE TABLE "user" ("id" varchar PRIMARY KEY NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "name" text(255) NOT NULL, "email" text(255) NOT NULL, "password" text(255) NOT NULL, "role" text(255) NOT NULL DEFAULT ('customer'), "phoneNumber" varchar NOT NULL, "address" varchar NOT NULL, "dateOfBirth" datetime NOT NULL, "profilePictureUrl" varchar, "status" text NOT NULL DEFAULT ('active'), "deletedAt" datetime, CONSTRAINT "UQ_e12875dfb3b1d92d7d7c5377e22" UNIQUE ("email"))`);
        await queryRunner.query(`DROP INDEX "Idx_ticket_tier_quantity"`);
        await queryRunner.query(`DROP INDEX "Idx_ticket_tier_price"`);
        await queryRunner.query(`CREATE TABLE "temporary_ticket_tier" ("id" varchar PRIMARY KEY NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "name" text NOT NULL, "price" integer NOT NULL, "quantity" integer NOT NULL, "concertId" varchar, CONSTRAINT "Uq_ticket_tier_concert_name" UNIQUE ("concertId", "name"), CONSTRAINT "FK_a73fe6d048dd02c9e9a70ed838f" FOREIGN KEY ("concertId") REFERENCES "concert" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION)`);
        await queryRunner.query(`INSERT INTO "temporary_ticket_tier"("id", "createdAt", "updatedAt", "name", "price", "quantity", "concertId") SELECT "id", "createdAt", "updatedAt", "name", "price", "quantity", "concertId" FROM "ticket_tier"`);
        await queryRunner.query(`DROP TABLE "ticket_tier"`);
        await queryRunner.query(`ALTER TABLE "temporary_ticket_tier" RENAME TO "ticket_tier"`);
        await queryRunner.query(`CREATE INDEX "Idx_ticket_tier_quantity" ON "ticket_tier" ("quantity") `);
        await queryRunner.query(`CREATE INDEX "Idx_ticket_tier_price" ON "ticket_tier" ("price") `);
        await queryRunner.query(`DROP INDEX "Idx_reserve_ticket_id"`);
        await queryRunner.query(`DROP INDEX "Idx_reserve_user_ticket"`);
        await queryRunner.query(`DROP INDEX "Idx_reserve_status"`);
        await queryRunner.query(`CREATE TABLE "temporary_reserve" ("id" varchar PRIMARY KEY NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "status" text NOT NULL DEFAULT ('pending'), "expiresAt" datetime NOT NULL, "userId" varchar, "ticketId" varchar, CONSTRAINT "FK_dc318c87bc1d6552424a88a6444" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION, CONSTRAINT "FK_4b0d1ff7d8b0498c45e47f47538" FOREIGN KEY ("ticketId") REFERENCES "ticket" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION)`);
        await queryRunner.query(`INSERT INTO "temporary_reserve"("id", "createdAt", "updatedAt", "status", "expiresAt", "userId", "ticketId") SELECT "id", "createdAt", "updatedAt", "status", "expiresAt", "userId", "ticketId" FROM "reserve"`);
        await queryRunner.query(`DROP TABLE "reserve"`);
        await queryRunner.query(`ALTER TABLE "temporary_reserve" RENAME TO "reserve"`);
        await queryRunner.query(`CREATE INDEX "Idx_reserve_ticket_id" ON "reserve" ("ticketId") `);
        await queryRunner.query(`CREATE INDEX "Idx_reserve_user_ticket" ON "reserve" ("userId", "ticketId") WHERE status = 'pending'`);
        await queryRunner.query(`CREATE INDEX "Idx_reserve_status" ON "reserve" ("status", "expiresAt") WHERE status = 'pending'`);
        await queryRunner.query(`DROP INDEX "Idx_ticket_user_id"`);
        await queryRunner.query(`DROP INDEX "Idx_sold_tickets"`);
        await queryRunner.query(`DROP INDEX "Idx_ticket_concert_user"`);
        await queryRunner.query(`CREATE TABLE "temporary_ticket" ("id" varchar PRIMARY KEY NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "seatNumber" integer NOT NULL, "status" text NOT NULL DEFAULT ('available'), "pricePaid" integer, "concertId" varchar, "userId" varchar, "ticketTierId" varchar, CONSTRAINT "Uq_ticket_concert_seat" UNIQUE ("concertId", "seatNumber"), CONSTRAINT "FK_ef8e1c3effd13564a3e3dd569ac" FOREIGN KEY ("concertId") REFERENCES "concert" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION, CONSTRAINT "FK_0e01a7c92f008418bad6bad5919" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION, CONSTRAINT "FK_40b8eb9e527f653c163bd00a231" FOREIGN KEY ("ticketTierId") REFERENCES "ticket_tier" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION)`);
        await queryRunner.query(`INSERT INTO "temporary_ticket"("id", "createdAt", "updatedAt", "seatNumber", "status", "pricePaid", "concertId", "userId", "ticketTierId") SELECT "id", "createdAt", "updatedAt", "seatNumber", "status", "pricePaid", "concertId", "userId", "ticketTierId" FROM "ticket"`);
        await queryRunner.query(`DROP TABLE "ticket"`);
        await queryRunner.query(`ALTER TABLE "temporary_ticket" RENAME TO "ticket"`);
        await queryRunner.query(`CREATE INDEX "Idx_ticket_user_id" ON "ticket" ("userId") `);
        await queryRunner.query(`CREATE INDEX "Idx_sold_tickets" ON "ticket" ("status", "concertId", "ticketTierId") WHERE status = 'sold'`);
        await queryRunner.query(`CREATE INDEX "Idx_ticket_concert_user" ON "ticket" ("concertId", "userId") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "Idx_ticket_concert_user"`);
        await queryRunner.query(`DROP INDEX "Idx_sold_tickets"`);
        await queryRunner.query(`DROP INDEX "Idx_ticket_user_id"`);
        await queryRunner.query(`ALTER TABLE "ticket" RENAME TO "temporary_ticket"`);
        await queryRunner.query(`CREATE TABLE "ticket" ("id" varchar PRIMARY KEY NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "seatNumber" integer NOT NULL, "status" text NOT NULL DEFAULT ('available'), "pricePaid" integer, "concertId" varchar, "userId" varchar, "ticketTierId" varchar, CONSTRAINT "Uq_ticket_concert_seat" UNIQUE ("concertId", "seatNumber"))`);
        await queryRunner.query(`INSERT INTO "ticket"("id", "createdAt", "updatedAt", "seatNumber", "status", "pricePaid", "concertId", "userId", "ticketTierId") SELECT "id", "createdAt", "updatedAt", "seatNumber", "status", "pricePaid", "concertId", "userId", "ticketTierId" FROM "temporary_ticket"`);
        await queryRunner.query(`DROP TABLE "temporary_ticket"`);
        await queryRunner.query(`CREATE INDEX "Idx_ticket_concert_user" ON "ticket" ("concertId", "userId") `);
        await queryRunner.query(`CREATE INDEX "Idx_sold_tickets" ON "ticket" ("status", "concertId", "ticketTierId") WHERE status = 'sold'`);
        await queryRunner.query(`CREATE INDEX "Idx_ticket_user_id" ON "ticket" ("userId") `);
        await queryRunner.query(`DROP INDEX "Idx_reserve_status"`);
        await queryRunner.query(`DROP INDEX "Idx_reserve_user_ticket"`);
        await queryRunner.query(`DROP INDEX "Idx_reserve_ticket_id"`);
        await queryRunner.query(`ALTER TABLE "reserve" RENAME TO "temporary_reserve"`);
        await queryRunner.query(`CREATE TABLE "reserve" ("id" varchar PRIMARY KEY NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "status" text NOT NULL DEFAULT ('pending'), "expiresAt" datetime NOT NULL, "userId" varchar, "ticketId" varchar)`);
        await queryRunner.query(`INSERT INTO "reserve"("id", "createdAt", "updatedAt", "status", "expiresAt", "userId", "ticketId") SELECT "id", "createdAt", "updatedAt", "status", "expiresAt", "userId", "ticketId" FROM "temporary_reserve"`);
        await queryRunner.query(`DROP TABLE "temporary_reserve"`);
        await queryRunner.query(`CREATE INDEX "Idx_reserve_status" ON "reserve" ("status", "expiresAt") WHERE status = 'pending'`);
        await queryRunner.query(`CREATE INDEX "Idx_reserve_user_ticket" ON "reserve" ("userId", "ticketId") WHERE status = 'pending'`);
        await queryRunner.query(`CREATE INDEX "Idx_reserve_ticket_id" ON "reserve" ("ticketId") `);
        await queryRunner.query(`DROP INDEX "Idx_ticket_tier_price"`);
        await queryRunner.query(`DROP INDEX "Idx_ticket_tier_quantity"`);
        await queryRunner.query(`ALTER TABLE "ticket_tier" RENAME TO "temporary_ticket_tier"`);
        await queryRunner.query(`CREATE TABLE "ticket_tier" ("id" varchar PRIMARY KEY NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "name" text NOT NULL, "price" integer NOT NULL, "quantity" integer NOT NULL, "concertId" varchar, CONSTRAINT "Uq_ticket_tier_concert_name" UNIQUE ("concertId", "name"))`);
        await queryRunner.query(`INSERT INTO "ticket_tier"("id", "createdAt", "updatedAt", "name", "price", "quantity", "concertId") SELECT "id", "createdAt", "updatedAt", "name", "price", "quantity", "concertId" FROM "temporary_ticket_tier"`);
        await queryRunner.query(`DROP TABLE "temporary_ticket_tier"`);
        await queryRunner.query(`CREATE INDEX "Idx_ticket_tier_price" ON "ticket_tier" ("price") `);
        await queryRunner.query(`CREATE INDEX "Idx_ticket_tier_quantity" ON "ticket_tier" ("quantity") `);
        await queryRunner.query(`DROP TABLE "user"`);
        await queryRunner.query(`DROP INDEX "Idx_ticket_concert_user"`);
        await queryRunner.query(`DROP INDEX "Idx_sold_tickets"`);
        await queryRunner.query(`DROP INDEX "Idx_ticket_user_id"`);
        await queryRunner.query(`DROP TABLE "ticket"`);
        await queryRunner.query(`DROP INDEX "Idx_reserve_status"`);
        await queryRunner.query(`DROP INDEX "Idx_reserve_user_ticket"`);
        await queryRunner.query(`DROP INDEX "Idx_reserve_ticket_id"`);
        await queryRunner.query(`DROP TABLE "reserve"`);
        await queryRunner.query(`DROP INDEX "Idx_concert_location"`);
        await queryRunner.query(`DROP INDEX "Idx_sorted_concert_status"`);
        await queryRunner.query(`DROP INDEX "Idx_concert_date"`);
        await queryRunner.query(`DROP TABLE "concert"`);
        await queryRunner.query(`DROP INDEX "Idx_ticket_tier_price"`);
        await queryRunner.query(`DROP INDEX "Idx_ticket_tier_quantity"`);
        await queryRunner.query(`DROP TABLE "ticket_tier"`);
    }

}
