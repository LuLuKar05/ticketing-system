import {Entity, Column, ManyToOne, OneToMany, Index, Unique} from 'typeorm';
import { User } from './User';
import { Concert } from './Concert';
import { Reserve } from './Reserve';
import { TicketTier } from './TicketTier';
import { AbstractEntity } from './AbstractEntity';


/**
 * Ticket Entity: represents a ticket for a concert, associated with a specific user and tickettier. 
 *It includes information about the seat number, status, and price paid. 
 * 
 * Idexing Strategy:
 * 1. Idx_ticket_concert_user:  Composite index on concert and user, used for checking if a user has already purchased a ticket for a specific concert. 
 * This index allows for efficient lookups of tickets by concert and user, which is useful for enforcing the one-ticket-per-user rule.
 * 
 * 2. Uq_ticket_concert_seat:   Unique index on concert and seatNumber, used to check if a specific seat has already been sold for a concert.
 * This index ensures that seat numbers are unique per concert, preventing double bookings of the same seat.
 * 
 * 3. Idx_sold_tickets:         Partial index on (status, concert, and ticketTier) used to calculate the number of sold tickets for a specific concert and ticket tier.
 * This is useful for determining if a ticket tier is sold out and also calculating the avaliable ticket for specific concerts and ticketTiers for generating sales reports.
 * 
 * 4. Idx_ticket_user_id:       B-Tree Index on user, used for retrieving all tickets purchased by a specific user.
 * This is useful for displaying a user's ticket history and for generating user-specific reports.
 */
export enum TicketStatus {
    AVAILABLE = 'available',
    SOLD = 'sold',
    CANCELLED = 'cancelled',
}
@Entity()
@Index("Idx_ticket_concert_user", ["concert", "user"])         
@Unique("Uq_ticket_concert_seat", ["concert", "seatNumber"]) 
@Index("Idx_sold_tickets", ["status","concert", "ticketTier"], { where: "status = 'sold'" }) 
@Index("Idx_ticket_user_id", ["user"])
export class Ticket extends AbstractEntity {
    //Basic info
    @Column({ type: 'int' })
    seatNumber!: number;
    //Ticket Status info
    @Column({ type: 'text', default: TicketStatus.AVAILABLE })
    status!: TicketStatus;

    @Column({type: 'int', nullable: true})
    pricePaid!: number | null;

    //Relations
    @ManyToOne(() => Concert, concert => concert.tickets)
    concert!: Concert;
    //A ticket may or may not be associated with a user (if it's been purchased or not)
    @ManyToOne(() => User, user => user.tickets,{nullable: true})
    user!: User | null;
    //A ticket can have multiple reserves
    @OneToMany(() => Reserve, reserve => reserve.ticket)
    reserves!: Reserve[];
    @ManyToOne(() => TicketTier, ticketTier => ticketTier.tickets)
    ticketTier !: TicketTier;

}