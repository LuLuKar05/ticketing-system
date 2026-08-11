import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 6a (A1) — passkey auth schema.
 *  - Relax legacy user columns: passwords are replaced by passkeys, and profile fields are now
 *    collected after registration, so `password`, `phoneNumber`, `address`, `dateOfBirth` become
 *    nullable. (`password` is fully dropped in A3.)
 *  - Add the `credential` table storing each user's WebAuthn public-key credentials.
 */
export class AuthPasskeySchema1786200000000 implements MigrationInterface {
    name = 'AuthPasskeySchema1786200000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "user" ALTER COLUMN "password" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "user" ALTER COLUMN "phoneNumber" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "user" ALTER COLUMN "address" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "user" ALTER COLUMN "dateOfBirth" DROP NOT NULL`);

        await queryRunner.query(`
            CREATE TABLE "credential" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
                "credentialId" character varying(255) NOT NULL,
                "publicKey" text NOT NULL,
                "counter" integer NOT NULL DEFAULT 0,
                "transports" text,
                "deviceType" character varying(32),
                "backedUp" boolean NOT NULL DEFAULT false,
                "aaguid" character varying(64),
                "nickname" character varying(100),
                "lastUsedAt" TIMESTAMP,
                "userId" uuid,
                CONSTRAINT "Uq_credential_credentialId" UNIQUE ("credentialId"),
                CONSTRAINT "PK_credential" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            ALTER TABLE "credential"
            ADD CONSTRAINT "FK_credential_user" FOREIGN KEY ("userId")
            REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "credential" DROP CONSTRAINT "FK_credential_user"`);
        await queryRunner.query(`DROP TABLE "credential"`);
        await queryRunner.query(`ALTER TABLE "user" ALTER COLUMN "dateOfBirth" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "user" ALTER COLUMN "address" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "user" ALTER COLUMN "phoneNumber" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "user" ALTER COLUMN "password" SET NOT NULL`);
    }
}
