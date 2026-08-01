import { Entity, Index, Unique, Column, ManyToOne } from 'typeorm';
import { AbstractEntity } from './AbstractEntity';
import { Concert } from './Concert';

/**
 * TicketTier Entity: a class of seats for a concert (e.g. VIP, General) carrying the price.
 * There is deliberately NO quantity column — capacity is derived from the seat catalog
 * (COUNT(Seat WHERE tier)), so it can never drift out of sync. See SEATMAP.md.
 *
 * Indexing Strategy:
 * 1. Idx_ticket_tier_price:        B-Tree index on price — lets clients browse/filter tiers by price.
 *
 * 2. Uq_ticket_tier_concert_name:  Unique on (concert, name) — tier names are unique within a
 * concert; also what the seat-map import resolves `tierName` against.
 */
@Entity()
@Unique('Uq_ticket_tier_concert_name', ['concert', 'name'])
@Index('Idx_ticket_tier_price', ['price'])
export class TicketTier extends AbstractEntity {
    @Column({ type: 'text' })
    name!: string;
    @Column({ type: 'int' })
    price!: number;
    // Capacity is NOT stored here — it is derived from COUNT(Seat WHERE tier). See SEATMAP.md.

    @ManyToOne(() => Concert, (concert) => concert.ticketTiers)
    concert!: Concert;
}
