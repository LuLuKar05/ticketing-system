import { MigrationInterface, QueryRunner } from "typeorm";

export class PartialSoldUniqueIndex1785420464504 implements MigrationInterface {
    name = 'PartialSoldUniqueIndex1785420464504'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "Idx_sold_tickets"`);
        await queryRunner.query(`DROP INDEX "Idx_ticket_user_id"`);
        await queryRunner.query(`DROP INDEX "Idx_ticket_concert_user"`);
        await queryRunner.query(`CREATE TABLE "temporary_ticket" ("id" varchar PRIMARY KEY NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "seatNumber" text NOT NULL, "status" text NOT NULL, "pricePaid" integer, "concertId" varchar, "userId" varchar, "ticketTierId" varchar, "orderId" varchar, CONSTRAINT "FK_8f4c2f0a2877e526e8881b51464" FOREIGN KEY ("orderId") REFERENCES "order" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION, CONSTRAINT "FK_ef8e1c3effd13564a3e3dd569ac" FOREIGN KEY ("concertId") REFERENCES "concert" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION, CONSTRAINT "FK_0e01a7c92f008418bad6bad5919" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION, CONSTRAINT "FK_40b8eb9e527f653c163bd00a231" FOREIGN KEY ("ticketTierId") REFERENCES "ticket_tier" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION)`);
        await queryRunner.query(`INSERT INTO "temporary_ticket"("id", "createdAt", "updatedAt", "seatNumber", "status", "pricePaid", "concertId", "userId", "ticketTierId", "orderId") SELECT "id", "createdAt", "updatedAt", "seatNumber", "status", "pricePaid", "concertId", "userId", "ticketTierId", "orderId" FROM "ticket"`);
        await queryRunner.query(`DROP TABLE "ticket"`);
        await queryRunner.query(`ALTER TABLE "temporary_ticket" RENAME TO "ticket"`);
        await queryRunner.query(`CREATE INDEX "Idx_sold_tickets" ON "ticket" ("status", "concertId", "ticketTierId") WHERE status = 'sold'`);
        await queryRunner.query(`CREATE INDEX "Idx_ticket_user_id" ON "ticket" ("userId") `);
        await queryRunner.query(`CREATE INDEX "Idx_ticket_concert_user" ON "ticket" ("concertId", "userId") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "Uq_ticket_concert_seat" ON "ticket" ("concertId", "seatNumber") WHERE status = 'sold'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "Uq_ticket_concert_seat"`);
        await queryRunner.query(`DROP INDEX "Idx_ticket_concert_user"`);
        await queryRunner.query(`DROP INDEX "Idx_ticket_user_id"`);
        await queryRunner.query(`DROP INDEX "Idx_sold_tickets"`);
        await queryRunner.query(`ALTER TABLE "ticket" RENAME TO "temporary_ticket"`);
        await queryRunner.query(`CREATE TABLE "ticket" ("id" varchar PRIMARY KEY NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "seatNumber" text NOT NULL, "status" text NOT NULL, "pricePaid" integer, "concertId" varchar, "userId" varchar, "ticketTierId" varchar, "orderId" varchar, CONSTRAINT "Uq_ticket_concert_seat" UNIQUE ("concertId", "seatNumber"), CONSTRAINT "FK_8f4c2f0a2877e526e8881b51464" FOREIGN KEY ("orderId") REFERENCES "order" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION, CONSTRAINT "FK_ef8e1c3effd13564a3e3dd569ac" FOREIGN KEY ("concertId") REFERENCES "concert" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION, CONSTRAINT "FK_0e01a7c92f008418bad6bad5919" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION, CONSTRAINT "FK_40b8eb9e527f653c163bd00a231" FOREIGN KEY ("ticketTierId") REFERENCES "ticket_tier" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION)`);
        await queryRunner.query(`INSERT INTO "ticket"("id", "createdAt", "updatedAt", "seatNumber", "status", "pricePaid", "concertId", "userId", "ticketTierId", "orderId") SELECT "id", "createdAt", "updatedAt", "seatNumber", "status", "pricePaid", "concertId", "userId", "ticketTierId", "orderId" FROM "temporary_ticket"`);
        await queryRunner.query(`DROP TABLE "temporary_ticket"`);
        await queryRunner.query(`CREATE INDEX "Idx_ticket_concert_user" ON "ticket" ("concertId", "userId") `);
        await queryRunner.query(`CREATE INDEX "Idx_ticket_user_id" ON "ticket" ("userId") `);
        await queryRunner.query(`CREATE INDEX "Idx_sold_tickets" ON "ticket" ("status", "concertId", "ticketTierId") WHERE status = 'sold'`);
    }

}
