import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, DeleteDateColumn, OneToMany} from 'typeorm';
import { Ticket } from './Ticket';
import { Reserve } from './Reserve';

export enum UserStatus {
    ACTIVE = 'active',
    INACTIVE = 'inactive',
    BANNED = 'banned'
}

@Entity()
export class User {
    @PrimaryGeneratedColumn('uuid')
    id!: string;
    //Basic info
    @Column({type: 'text', length: 255})
    name!: string;
    @Column({type: 'text', length: 255, unique: true })
    email!: string;
    @Column({type: 'text', length: 255})
    password!: string;

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

    @CreateDateColumn()
    createdAt!: Date;
    @UpdateDateColumn()
    updatedAt!: Date;
    @DeleteDateColumn({ nullable: true })// Soft delete column
    deletedAt?: Date;
}