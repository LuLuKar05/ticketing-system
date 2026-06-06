import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, DeleteDateColumn} from 'typeorm';
//import { Reserve } from './Reserve';
import { Ticket } from './Ticket';

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
    @Column({ type: 'simple-array' })
    tickets!: Ticket[]; // Array of Ticket IDs


    //Additional fields
    @Column({ nullable: true })
    phoneNumber?: string;
    @Column({ nullable: true })
    address?: string;
    @Column({ nullable: true })
    dateOfBirth!: Date;
    @Column({ nullable: true })
    profilePictureUrl?: string;

    @Column({ type: 'enum', enum: ['active', 'inactive', 'banned'], default: 'active' })
    status!: string;

    @CreateDateColumn({ type: 'timestamp'})
    createdAt!: Date;
    @UpdateDateColumn({ type: 'timestamp'})
    updatedAt!: Date;
    @DeleteDateColumn({ type: 'timestamp', nullable: true })// Soft delete column
    deletedAt?: Date;
}