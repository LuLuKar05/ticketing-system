import { Entity, Column, DeleteDateColumn, OneToMany} from 'typeorm';
import { AbstractEntity } from './AbstractEntity';
import { Ticket } from './Ticket';
import { Reserve } from './Reserve';

/**
 * User Entity: represents a user in the ticketing system.
 * It includes basic user information such as name, email, password, role, and status.
 * 
 * Indexing Strategy:
 * 1. Idx_user_email:            Unique index on email, used for user authentication and ensuring unique email addresses.
 * This index allows for efficient lookups of users by email, which is useful for login and registration processes.
 * 
 * 2. Idx_user_status:           B-Tree Index on status, used for retrieving users based on their status (active, inactive, banned).
 * This is useful for administrative purposes, such as managing user accounts and filtering users based on their status.
 * 
 * 3. Idx_user_role:             B-Tree Index on role, used for retrieving users based on their role (customer, admin).
 * This is useful for administrative purposes, such as managing user accounts and filtering users based on their role.
 */
export enum UserStatus {
    ACTIVE = 'active',
    INACTIVE = 'inactive',
    BANNED = 'banned'
}

@Entity()
export class User extends AbstractEntity {
    //Basic info
    @Column({type: 'text', length: 255})
    name!: string;
    @Column({type: 'text', length: 255, unique: true })
    email!: string;
    @Column({type: 'text', length: 255, select: false}) // Exclude password from queries by default for security
    password!: string;
    @Column({type: 'text', length: 255, default: 'customer'})
    role!: string;

    //Relations
    @OneToMany(() => Ticket, ticket => ticket.user)
    tickets!: Ticket[];
    @OneToMany(() => Reserve, reserve => reserve.user)
    reserves!: Reserve[];

    //Additional fields
    @Column()
    phoneNumber!: string;
    @Column()
    address!: string;
    @Column()
    dateOfBirth!: Date;
    @Column({ nullable: true })
    profilePictureUrl?: string;

    @Column({ type: 'text', default: UserStatus.ACTIVE })
    status!: UserStatus;

    @DeleteDateColumn({ nullable: true })// Soft delete column
    deletedAt?: Date;
}