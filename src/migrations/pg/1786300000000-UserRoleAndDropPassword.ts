import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 6a (A3) — role authorization + retire the password column.
 *  - Drop the now-unused `password` column (auth is passkeys only).
 *  - Constrain `role` to the known values with a CHECK (roles stay a portable varchar, not a native
 *    PG enum — see README's consistency-model note).
 */
export class UserRoleAndDropPassword1786300000000 implements MigrationInterface {
    name = 'UserRoleAndDropPassword1786300000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "password"`);
        await queryRunner.query(
            `ALTER TABLE "user" ADD CONSTRAINT "Chk_user_role" CHECK ("role" IN ('customer', 'admin'))`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "user" DROP CONSTRAINT "Chk_user_role"`);
        await queryRunner.query(`ALTER TABLE "user" ADD COLUMN "password" character varying(255)`);
    }
}
