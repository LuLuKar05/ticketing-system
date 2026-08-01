import { Entity, Column, ManyToOne, Index } from 'typeorm';
import { User } from './User';
import { Concert } from './Concert';
import { TicketTier } from './TicketTier';
import { AbstractEntity } from './AbstractEntity';
import { Order } from './Order';

/**
 * Ticket Entity: represents a ticket for a concert, associated with a specific user and tickettier.
 *It includes information about the seat number, status, and price paid.
 *
 * Idexing Strategy:
 * 1. Idx_ticket_concert_user:  Composite index on concert and user, used for checking if a user has already purchased a ticket for a specific concert.
 * This index allows for efficient lookups of tickets by concert and user, which is useful for enforcing the one-ticket-per-user rule.
 *
 * 2. Uq_ticket_concert_seat:   PARTIAL unique index on (concert, seatNumber) WHERE status='sold'.
 * It guarantees at most one *sold* ticket per seat (the authoritative double-sell backstop in confirmOrder),
 * while allowing REFUNDED/CANCELLED rows to coexist — so a refunded seat can be sold again (resale).
 *
 * 3. Idx_sold_tickets:         Partial index on (status, concert, and ticketTier) used to calculate the number of sold tickets for a specific concert and ticket tier.
 * This is useful for determining if a ticket tier is sold out and also calculating the avaliable ticket for specific concerts and ticketTiers for generating sales reports.
 *
 * 4. Idx_ticket_user_id:       B-Tree Index on user, used for retrieving all tickets purchased by a specific user.
 * This is useful for displaying a user's ticket history and for generating user-specific reports.
 */
export enum TicketStatus {
    SOLD = 'sold',
    CANCELLED = 'cancelled',
    REFUNDED = 'refunded',
}
@Entity()
@Index('Idx_ticket_concert_user', ['concert', 'user'])
@Index('Uq_ticket_concert_seat', ['concert', 'seatNumber'], { unique: true, where: "status = 'sold'" })
@Index('Idx_sold_tickets', ['status', 'concert', 'ticketTier'], { where: "status = 'sold'" })
@Index('Idx_ticket_user_id', ['user'])
export class Ticket extends AbstractEntity {
    //Basic info
    @Column({ type: 'text' })
    seatNumber!: string;
    //Ticket Status info
    @Column({ type: 'text' })
    status!: TicketStatus;
    @Column({ type: 'int', nullable: true })
    pricePaid!: number | null;
    //Relations
    @ManyToOne(() => Concert)
    concert!: Concert;
    //A ticket may or may not be associated with a user (if it's been purchased or not)
    @ManyToOne(() => User, (user) => user.tickets, { nullable: true })
    user!: User | null;

    @ManyToOne(() => TicketTier)
    ticketTier!: TicketTier;
    @ManyToOne(() => Order, (order) => order.tickets)
    order!: Order;
}
