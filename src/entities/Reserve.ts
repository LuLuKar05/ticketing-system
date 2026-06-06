import {Entity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn} from 'typeorm';
import {Ticket} from './Ticket';
import {User} from './User';

export enum ReserveStatus {
    PENDING     = 'pending',
    CONFIRMED   = 'confirmed',
    CANCELLED   = 'cancelled'
}

@Entity()
export class Reserve {
    @PrimaryGeneratedColumn('uuid')
    id!: string;
    @Column({type:'text', default: ReserveStatus.PENDING})
    status!: ReserveStatus;


    //Relations
    @ManyToOne(() => User, user => user.reserves)// Assuming a user can have multiple tickets
    user!: User;
    @ManyToOne(() => Ticket, ticket => ticket.reserves)//
    ticket!: Ticket;

    @CreateDateColumn({type: 'timestamp'})
    createdAt!: Date;
}