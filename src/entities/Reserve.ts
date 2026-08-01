import { Entity, Column, ManyToOne, Index } from 'typeorm';
import { User } from './User';
import { Order } from './Order';
import { AbstractEntity } from './AbstractEntity';
import { Concert } from './Concert';
import { TicketTier } from './TicketTier';
/**
 * Reserve Entity: an exclusive, time-boxed HOLD on one seat (hard-hold model). Carries its own
 * seat identity (concert, ticketTier, seatNumber) — there is NO ticket FK; the Ticket is only
 * created at payment. Sibling of Ticket under Order.
 *
 * Indexing Strategy:
 * 1. Idx_reserve_status:           Partial index on (status, expiresAt) WHERE status='pending' —
 * lets the sweeper find expired PENDING holds without scanning terminal rows.
 *
 * 2. Uqi_reserve_concert_seat:     Partial UNIQUE on (concert, seatNumber) WHERE status='pending' —
 * THE exclusivity guarantee: at most one active hold per seat. Because it only covers 'pending',
 * flipping a hold to cancelled/confirmed frees the seat automatically.
 */

export enum ReserveStatus {
    PENDING = 'pending',
    CONFIRMED = 'confirmed',
    CANCELLED = 'cancelled',
}

@Entity()
@Index('Idx_reserve_status', ['status', 'expiresAt'], { where: "status = 'pending'" })
@Index('Uqi_reserve_concert_seat', ['concert', 'seatNumber'], { where: "status = 'pending'", unique: true })
export class Reserve extends AbstractEntity {
    @Column({ type: 'text', default: ReserveStatus.PENDING })
    status!: ReserveStatus;
    @Column({ type: 'text' })
    seatNumber!: string;

    //Relations
    @ManyToOne(() => User, (user) => user.reserves)
    user!: User;
    @ManyToOne(() => Concert)
    concert!: Concert;
    @ManyToOne(() => TicketTier)
    ticketTier!: TicketTier;
    @ManyToOne(() => Order, (order) => order.reserves)
    order!: Order;

    @Column()
    expiresAt!: Date;
}
