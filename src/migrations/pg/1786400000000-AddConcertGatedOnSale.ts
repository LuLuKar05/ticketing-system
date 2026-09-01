import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Waiting-room queue: flag a concert as gated so buyers must be admitted before holding seats.
 */
export class AddConcertGatedOnSale1786400000000 implements MigrationInterface {
    name = 'AddConcertGatedOnSale1786400000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "concert" ADD "gatedOnSale" boolean NOT NULL DEFAULT false`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "concert" DROP COLUMN "gatedOnSale"`);
    }
}
