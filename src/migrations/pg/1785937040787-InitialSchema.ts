import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialSchema1785937040787 implements MigrationInterface {
    name = 'InitialSchema1785937040787'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // uuid_generate_v4() (used by the id column defaults below) lives in the uuid-ossp extension.
        await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
        await queryRunner.query(`CREATE TABLE "ticket_tier" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "name" text NOT NULL, "price" integer NOT NULL, "concertId" uuid, CONSTRAINT "Uq_ticket_tier_concert_name" UNIQUE ("concertId", "name"), CONSTRAINT "PK_3a637a1e713d04b2ed80fc5d78d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "Idx_ticket_tier_price" ON "ticket_tier"  ("price") `);
        await queryRunner.query(`CREATE TABLE "concert" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "name" character varying NOT NULL, "concertDate" TIMESTAMP NOT NULL, "description" character varying(1000) NOT NULL, "imageUrl" character varying NOT NULL, "location" character varying NOT NULL, "artist" text NOT NULL, "genre" text NOT NULL, "totalTickets" integer NOT NULL, "duration" integer NOT NULL, "ageRestriction" integer NOT NULL, "oneTicketPerUser" boolean NOT NULL DEFAULT false, "status" text NOT NULL DEFAULT 'upcoming', CONSTRAINT "PK_c96bfb33ee9a95525a3f5269d1f" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "Idx_concert_date" ON "concert"  ("concertDate") `);
        await queryRunner.query(`CREATE INDEX "Idx_sorted_concert_status" ON "concert"  ("status", "concertDate") `);
        await queryRunner.query(`CREATE INDEX "Idx_concert_location" ON "concert"  ("location") `);
        await queryRunner.query(`CREATE TABLE "reserve" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "status" text NOT NULL DEFAULT 'pending', "seatNumber" text NOT NULL, "expiresAt" TIMESTAMP NOT NULL, "userId" uuid, "concertId" uuid, "ticketTierId" uuid, "orderId" uuid, CONSTRAINT "PK_619d1e12dbedbe126620cac8240" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "Uqi_reserve_concert_seat" ON "reserve"  ("concertId", "seatNumber") WHERE status = 'pending'`);
        await queryRunner.query(`CREATE INDEX "Idx_reserve_status" ON "reserve"  ("status", "expiresAt") WHERE status = 'pending'`);
        await queryRunner.query(`CREATE TABLE "order" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "status" text NOT NULL DEFAULT 'pending', "totalAmount" integer, "userId" uuid, CONSTRAINT "PK_1031171c13130102495201e3e20" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "Idx_order_user" ON "order"  ("userId") `);
        await queryRunner.query(`CREATE TABLE "ticket" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "seatNumber" text NOT NULL, "status" text NOT NULL, "pricePaid" integer, "concertId" uuid, "userId" uuid, "ticketTierId" uuid, "orderId" uuid, CONSTRAINT "PK_d9a0835407701eb86f874474b7c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "Idx_ticket_user_id" ON "ticket"  ("userId") `);
        await queryRunner.query(`CREATE INDEX "Idx_sold_tickets" ON "ticket"  ("status", "concertId", "ticketTierId") WHERE status = 'sold'`);
        await queryRunner.query(`CREATE UNIQUE INDEX "Uq_ticket_concert_seat" ON "ticket"  ("concertId", "seatNumber") WHERE status = 'sold'`);
        await queryRunner.query(`CREATE INDEX "Idx_ticket_concert_user" ON "ticket"  ("concertId", "userId") `);
        await queryRunner.query(`CREATE TABLE "user" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "name" character varying(255) NOT NULL, "email" character varying(255) NOT NULL, "password" character varying(255) NOT NULL, "role" character varying(255) NOT NULL DEFAULT 'customer', "phoneNumber" character varying NOT NULL, "address" character varying NOT NULL, "dateOfBirth" TIMESTAMP NOT NULL, "profilePictureUrl" character varying, "status" text NOT NULL DEFAULT 'active', "deletedAt" TIMESTAMP, CONSTRAINT "UQ_e12875dfb3b1d92d7d7c5377e22" UNIQUE ("email"), CONSTRAINT "PK_cace4a159ff9f2512dd42373760" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "seat" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "seatNumber" text NOT NULL, "section" text, "rowLabel" text, "concertId" uuid, "ticketTierId" uuid, CONSTRAINT "Uq_seat_concert_seatNumber" UNIQUE ("concertId", "seatNumber"), CONSTRAINT "PK_4e72ae40c3fbd7711ccb380ac17" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "Idx_seat_concert_tier" ON "seat"  ("concertId", "ticketTierId") `);
        await queryRunner.query(`ALTER TABLE "ticket_tier" ADD CONSTRAINT "FK_a73fe6d048dd02c9e9a70ed838f" FOREIGN KEY ("concertId") REFERENCES "concert"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "reserve" ADD CONSTRAINT "FK_dc318c87bc1d6552424a88a6444" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "reserve" ADD CONSTRAINT "FK_a3c7f5e645255435f49bf1302e2" FOREIGN KEY ("concertId") REFERENCES "concert"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "reserve" ADD CONSTRAINT "FK_d1fbf4fb794eeef0c517f7a068d" FOREIGN KEY ("ticketTierId") REFERENCES "ticket_tier"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "reserve" ADD CONSTRAINT "FK_06acfce86b754f3d225d161bfd7" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "order" ADD CONSTRAINT "FK_caabe91507b3379c7ba73637b84" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "ticket" ADD CONSTRAINT "FK_ef8e1c3effd13564a3e3dd569ac" FOREIGN KEY ("concertId") REFERENCES "concert"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "ticket" ADD CONSTRAINT "FK_0e01a7c92f008418bad6bad5919" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "ticket" ADD CONSTRAINT "FK_40b8eb9e527f653c163bd00a231" FOREIGN KEY ("ticketTierId") REFERENCES "ticket_tier"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "ticket" ADD CONSTRAINT "FK_8f4c2f0a2877e526e8881b51464" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "seat" ADD CONSTRAINT "FK_570eb4227fc33ce79013c871bd7" FOREIGN KEY ("concertId") REFERENCES "concert"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "seat" ADD CONSTRAINT "FK_f3d9512d4eba9c48d839a5cadd3" FOREIGN KEY ("ticketTierId") REFERENCES "ticket_tier"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "seat" DROP CONSTRAINT "FK_f3d9512d4eba9c48d839a5cadd3"`);
        await queryRunner.query(`ALTER TABLE "seat" DROP CONSTRAINT "FK_570eb4227fc33ce79013c871bd7"`);
        await queryRunner.query(`ALTER TABLE "ticket" DROP CONSTRAINT "FK_8f4c2f0a2877e526e8881b51464"`);
        await queryRunner.query(`ALTER TABLE "ticket" DROP CONSTRAINT "FK_40b8eb9e527f653c163bd00a231"`);
        await queryRunner.query(`ALTER TABLE "ticket" DROP CONSTRAINT "FK_0e01a7c92f008418bad6bad5919"`);
        await queryRunner.query(`ALTER TABLE "ticket" DROP CONSTRAINT "FK_ef8e1c3effd13564a3e3dd569ac"`);
        await queryRunner.query(`ALTER TABLE "order" DROP CONSTRAINT "FK_caabe91507b3379c7ba73637b84"`);
        await queryRunner.query(`ALTER TABLE "reserve" DROP CONSTRAINT "FK_06acfce86b754f3d225d161bfd7"`);
        await queryRunner.query(`ALTER TABLE "reserve" DROP CONSTRAINT "FK_d1fbf4fb794eeef0c517f7a068d"`);
        await queryRunner.query(`ALTER TABLE "reserve" DROP CONSTRAINT "FK_a3c7f5e645255435f49bf1302e2"`);
        await queryRunner.query(`ALTER TABLE "reserve" DROP CONSTRAINT "FK_dc318c87bc1d6552424a88a6444"`);
        await queryRunner.query(`ALTER TABLE "ticket_tier" DROP CONSTRAINT "FK_a73fe6d048dd02c9e9a70ed838f"`);
        await queryRunner.query(`DROP INDEX "public"."Idx_seat_concert_tier"`);
        await queryRunner.query(`DROP TABLE "seat"`);
        await queryRunner.query(`DROP TABLE "user"`);
        await queryRunner.query(`DROP INDEX "public"."Idx_ticket_concert_user"`);
        await queryRunner.query(`DROP INDEX "public"."Uq_ticket_concert_seat"`);
        await queryRunner.query(`DROP INDEX "public"."Idx_sold_tickets"`);
        await queryRunner.query(`DROP INDEX "public"."Idx_ticket_user_id"`);
        await queryRunner.query(`DROP TABLE "ticket"`);
        await queryRunner.query(`DROP INDEX "public"."Idx_order_user"`);
        await queryRunner.query(`DROP TABLE "order"`);
        await queryRunner.query(`DROP INDEX "public"."Idx_reserve_status"`);
        await queryRunner.query(`DROP INDEX "public"."Uqi_reserve_concert_seat"`);
        await queryRunner.query(`DROP TABLE "reserve"`);
        await queryRunner.query(`DROP INDEX "public"."Idx_concert_location"`);
        await queryRunner.query(`DROP INDEX "public"."Idx_sorted_concert_status"`);
        await queryRunner.query(`DROP INDEX "public"."Idx_concert_date"`);
        await queryRunner.query(`DROP TABLE "concert"`);
        await queryRunner.query(`DROP INDEX "public"."Idx_ticket_tier_price"`);
        await queryRunner.query(`DROP TABLE "ticket_tier"`);
    }

}
