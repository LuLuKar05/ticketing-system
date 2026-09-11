import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 6b — payment gateway. Records which charge paid for an order.
 *
 * Both columns are nullable: every existing order predates payments, and an order only acquires a
 * reference at the moment the charge settles. The new `paying` status needs no schema change —
 * `order.status` is a plain text column (enums are stored as portable text in this project).
 */
export class AddOrderPaymentFields1786500000000 implements MigrationInterface {
    name = 'AddOrderPaymentFields1786500000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "order" ADD "paymentRef" text`);
        await queryRunner.query(`ALTER TABLE "order" ADD "paidAt" TIMESTAMP`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "order" DROP COLUMN "paidAt"`);
        await queryRunner.query(`ALTER TABLE "order" DROP COLUMN "paymentRef"`);
    }
}
