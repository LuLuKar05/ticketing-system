import {Entity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn, UpdateDateColumn} from 'typeorm';
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

    //TTL for the Reservation: (15 mins)
    //will set the default value to 15 mins from the time of creation in the service layer when creating a reserve
    @Column()
    expiresAt!: Date;

    //Timestamps
    @CreateDateColumn()
    createdAt!: Date;
    @UpdateDateColumn()
    updatedAt!: Date;

}