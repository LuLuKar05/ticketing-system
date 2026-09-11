import { Entity, Column, ManyToOne, OneToMany, Index } from 'typeorm';
import { AbstractEntity } from './AbstractEntity';
import { User } from './User';
import { Reserve } from './Reserve';
import { Ticket } from './Ticket';

/**
 * Order Entity: groups one or more per-seat Reserves into a single purchase
 * (a "cart"). Lets a customer reserve/buy multiple seats at once for a
 * non-oneTicketPerUser concert, and gives payment an all-or-nothing boundary:
 * either every seat in the order is sold, or none are.
 *
 * Order 1───N Reserve (holds) and Order 1───N Ticket (sold seats) — SIBLINGS.
 * Reserve and Ticket each carry their own seat identity (concert, tier, seatNumber);
 * a Reserve does NOT point to a Ticket. At payment, each Reserve becomes a Ticket.
 */
export enum OrderStatus {
    PENDING = 'pending',
    /**
     * A charge is in flight. The order was claimed for payment and COMMITTED in this state before
     * the gateway was called, so a concurrent confirm can see that money is already moving instead
     * of starting a second attempt — and a crash mid-charge leaves a visible, recoverable marker
     * rather than a silently half-paid order.
     */
    PAYING = 'paying',
    CONFIRMED = 'confirmed',
    CANCELLED = 'cancelled',
    FAILED = 'failed',
}

@Entity()
@Index('Idx_order_user', ['user'])
export class Order extends AbstractEntity {
    @Column({ type: 'text', default: OrderStatus.PENDING })
    status!: OrderStatus;

    // Total charged, in minor units (cents). Null until computed at confirmation.
    @Column({ type: 'int', nullable: true })
    totalAmount!: number | null;

    // The provider's charge reference, and when it settled. Null until payment succeeds; together
    // they are the audit trail tying an order to the money that paid for it.
    @Column({ type: 'text', nullable: true })
    paymentRef!: string | null;

    @Column({ type: 'timestamp', nullable: true })
    paidAt!: Date | null;

    @ManyToOne(() => User)
    user!: User;

    //Child Entities: Reserves and Tickets. An Order can have multiple Reserves and Tickets.
    @OneToMany(() => Reserve, (reserve) => reserve.order)
    reserves!: Reserve[];
    @OneToMany(() => Ticket, (ticket) => ticket.order)
    tickets!: Ticket[];
}
