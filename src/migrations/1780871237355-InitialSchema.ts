import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialSchema1780871237355 implements MigrationInterface {
    name = 'InitialSchema1780871237355'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "concert" ("id" varchar PRIMARY KEY NOT NULL, "name" varchar NOT NULL, "concertDate" datetime NOT NULL, "description" text(1000) NOT NULL, "imageUrl" varchar NOT NULL, "price" integer NOT NULL, "location" varchar NOT NULL, "artist" text NOT NULL, "genre" text NOT NULL, "totalTickets" integer NOT NULL, "availableTickets" integer NOT NULL, "duration" integer NOT NULL, "ageRestriction" integer NOT NULL, "oneTicketPerUser" boolean NOT NULL DEFAULT (0), "status" text NOT NULL DEFAULT ('upcoming'), "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')))`);
        await queryRunner.query(`CREATE TABLE "reserve" ("id" varchar PRIMARY KEY NOT NULL, "status" text NOT NULL DEFAULT ('pending'), "expiresAt" datetime NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "userId" varchar, "ticketId" varchar)`);
        await queryRunner.query(`CREATE TABLE "ticket" ("id" varchar PRIMARY KEY NOT NULL, "seatNumber" integer NOT NULL, "status" text NOT NULL DEFAULT ('available'), "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "concertId" varchar, "userId" varchar)`);
        await queryRunner.query(`CREATE TABLE "user" ("id" varchar PRIMARY KEY NOT NULL, "name" text(255) NOT NULL, "email" text(255) NOT NULL, "password" text(255) NOT NULL, "phoneNumber" varchar NOT NULL, "address" varchar NOT NULL, "dateOfBirth" datetime NOT NULL, "profilePictureUrl" varchar, "status" text NOT NULL DEFAULT ('active'), "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "deletedAt" datetime, CONSTRAINT "UQ_e12875dfb3b1d92d7d7c5377e22" UNIQUE ("email"))`);
        await queryRunner.query(`CREATE TABLE "temporary_reserve" ("id" varchar PRIMARY KEY NOT NULL, "status" text NOT NULL DEFAULT ('pending'), "expiresAt" datetime NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "userId" varchar, "ticketId" varchar, CONSTRAINT "FK_dc318c87bc1d6552424a88a6444" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION, CONSTRAINT "FK_4b0d1ff7d8b0498c45e47f47538" FOREIGN KEY ("ticketId") REFERENCES "ticket" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION)`);
        await queryRunner.query(`INSERT INTO "temporary_reserve"("id", "status", "expiresAt", "createdAt", "updatedAt", "userId", "ticketId") SELECT "id", "status", "expiresAt", "createdAt", "updatedAt", "userId", "ticketId" FROM "reserve"`);
        await queryRunner.query(`DROP TABLE "reserve"`);
        await queryRunner.query(`ALTER TABLE "temporary_reserve" RENAME TO "reserve"`);
        await queryRunner.query(`CREATE TABLE "temporary_ticket" ("id" varchar PRIMARY KEY NOT NULL, "seatNumber" integer NOT NULL, "status" text NOT NULL DEFAULT ('available'), "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "concertId" varchar, "userId" varchar, CONSTRAINT "FK_ef8e1c3effd13564a3e3dd569ac" FOREIGN KEY ("concertId") REFERENCES "concert" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION, CONSTRAINT "FK_0e01a7c92f008418bad6bad5919" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION)`);
        await queryRunner.query(`INSERT INTO "temporary_ticket"("id", "seatNumber", "status", "createdAt", "updatedAt", "concertId", "userId") SELECT "id", "seatNumber", "status", "createdAt", "updatedAt", "concertId", "userId" FROM "ticket"`);
        await queryRunner.query(`DROP TABLE "ticket"`);
        await queryRunner.query(`ALTER TABLE "temporary_ticket" RENAME TO "ticket"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "ticket" RENAME TO "temporary_ticket"`);
        await queryRunner.query(`CREATE TABLE "ticket" ("id" varchar PRIMARY KEY NOT NULL, "seatNumber" integer NOT NULL, "status" text NOT NULL DEFAULT ('available'), "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "concertId" varchar, "userId" varchar)`);
        await queryRunner.query(`INSERT INTO "ticket"("id", "seatNumber", "status", "createdAt", "updatedAt", "concertId", "userId") SELECT "id", "seatNumber", "status", "createdAt", "updatedAt", "concertId", "userId" FROM "temporary_ticket"`);
        await queryRunner.query(`DROP TABLE "temporary_ticket"`);
        await queryRunner.query(`ALTER TABLE "reserve" RENAME TO "temporary_reserve"`);
        await queryRunner.query(`CREATE TABLE "reserve" ("id" varchar PRIMARY KEY NOT NULL, "status" text NOT NULL DEFAULT ('pending'), "expiresAt" datetime NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "userId" varchar, "ticketId" varchar)`);
        await queryRunner.query(`INSERT INTO "reserve"("id", "status", "expiresAt", "createdAt", "updatedAt", "userId", "ticketId") SELECT "id", "status", "expiresAt", "createdAt", "updatedAt", "userId", "ticketId" FROM "temporary_reserve"`);
        await queryRunner.query(`DROP TABLE "temporary_reserve"`);
        await queryRunner.query(`DROP TABLE "user"`);
        await queryRunner.query(`DROP TABLE "ticket"`);
        await queryRunner.query(`DROP TABLE "reserve"`);
        await queryRunner.query(`DROP TABLE "concert"`);
    }

}
