import { Entity, Column, ManyToOne, Unique } from 'typeorm';
import { AbstractEntity } from './AbstractEntity';
import { User } from './User';

/**
 * A registered WebAuthn / passkey credential. One user may have many (one per device).
 *
 * The `publicKey` is stored as base64url text — it is *public*, so it is not hashed; the matching
 * private key never leaves the user's authenticator. `counter` is the authenticator sign counter,
 * used for clone detection (a replayed credential would present a counter that didn't advance).
 */
@Entity()
@Unique('Uq_credential_credentialId', ['credentialId'])
export class Credential extends AbstractEntity {
    /** base64url credential ID returned by the authenticator. */
    @Column({ type: 'varchar', length: 255 })
    credentialId!: string;

    /** base64url-encoded COSE public key. */
    @Column({ type: 'text' })
    publicKey!: string;

    /** Authenticator sign counter (0 for most platform passkeys, which never increment it). */
    @Column({ type: 'int', default: 0 })
    counter!: number;

    /** e.g. ['internal', 'hybrid', 'usb'] — how the authenticator can be reached. */
    @Column({ type: 'simple-array', nullable: true })
    transports?: string[];

    /** 'singleDevice' | 'multiDevice' (a synced passkey is multiDevice). */
    @Column({ type: 'varchar', length: 32, nullable: true })
    deviceType?: string;

    /** Whether the credential is backed up / synced (e.g. iCloud Keychain, Google Password Manager). */
    @Column({ type: 'boolean', default: false })
    backedUp!: boolean;

    /** Authenticator model identifier (make/model). Empty/zeroed under attestation 'none'. */
    @Column({ type: 'varchar', length: 64, nullable: true })
    aaguid?: string;

    /** Optional user-facing label ("My phone", "Work laptop"). */
    @Column({ type: 'varchar', length: 100, nullable: true })
    nickname?: string;

    @Column({ type: 'timestamp', nullable: true })
    lastUsedAt?: Date;

    @ManyToOne(() => User, (user) => user.credentials, { onDelete: 'CASCADE' })
    user!: User;
}
