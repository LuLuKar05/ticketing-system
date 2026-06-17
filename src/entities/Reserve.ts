import {Entity, Column, ManyToOne, Index} from 'typeorm';
import {Ticket} from './Ticket';
import {User} from './User';
import { AbstractEntity } from './AbstractEntity';
/**
 * Reserve Entity: represents a reservation for a ticket by a user.
 * It includes information about the status of the reservation and the expiration time.
 *
 * Indexing Strategy: 
 * 1. Idx_reserve_status:       Partial index on (status, expiresAt) used to quickly find pending reserves that are about to expire.
 * This is useful for the cron job that cleans up expired reserves. This can help to quickly find pending reserves that are about to expire and turn them into expired reserves.
 * 
 * 2. Idx_reserve_user_ticket:  Composite index on (user, ticket) used to quickly find pending reserves for a specific user and ticket.
 * This is useful for checking if a user has already reserved a specific ticket. This can help to prevent users from reserving the same ticket multiple times at the same time.
 * 
 * 3. Idx_reserve_ticket_id:    B-Tree Index on ticket, used for retrieving all reserves associated with a specific ticket.
 * This is useful for displaying all reservations for a specific ticket and for generating ticket-specific reports.
 * This is useful for turning the ticket status to sold and canceling other pending reserves when a ticket is purchased. 
*/

export enum ReserveStatus {
    PENDING     = 'pending',
    CONFIRMED   = 'confirmed',
    CANCELLED   = 'cancelled'
}

@Entity()
@Index("Idx_reserve_status",['status', 'expiresAt'], {where: "status = 'pending'"})  
@Index("Idx_reserve_user_ticket",['user','ticket'], {where: "status = 'pending'"})        
@Index("Idx_reserve_ticket_id",['ticket']) 

export class Reserve extends AbstractEntity {
    @Column({type:'text', default: ReserveStatus.PENDING})
    status!: ReserveStatus;

    //Relations
    @ManyToOne(() => User, user => user.reserves)
    user!: User;
    @ManyToOne(() => Ticket, ticket => ticket.reserves)
    ticket!: Ticket;

    //TTL for the Reservation: (15 mins)
    @Column()
    expiresAt!: Date;
}