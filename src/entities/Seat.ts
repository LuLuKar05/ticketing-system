import { Entity, Column, ManyToOne, Unique, Index } from 'typeorm';
import { AbstractEntity } from './AbstractEntity';
import { Concert } from './Concert';
import { TicketTier } from './TicketTier';

/**
 * Seat = the venue LAYOUT catalog for a concert (one row per physical seat). It stores the
 * definition of what seats exist and which tier each belongs to — NOT availability. A seat's
 * live status is derived (SOLD if a Ticket exists, HELD if a PENDING+unexpired Reserve exists,
 * else AVAILABLE). See SEATMAP.md.
 *
 * Both modes use this catalog: assigned seating (buyer picks) and general admission
 * (fungible `GA-n` seats the server auto-assigns). Capacity per tier = COUNT(seat WHERE tier).
 */
@Entity()
@Unique('Uq_seat_concert_seatNumber', ['concert', 'seatNumber']) // one physical seat per label per concert
@Index('Idx_seat_concert_tier', ['concert', 'ticketTier']) // capacity / availability queries
export class Seat extends AbstractEntity {
    @Column({ type: 'text' })
    seatNumber!: string;
    @Column({ type: 'text', nullable: true })
    section!: string | null;
    // "row" is a reserved SQL word — store the row label under a safe column name.
    @Column({ type: 'text', nullable: true })
    rowLabel!: string | null;

    // One-directional (no inverse on Concert/TicketTier), consistent with the rest of the model.
    @ManyToOne(() => Concert)
    concert!: Concert;
    @ManyToOne(() => TicketTier)
    ticketTier!: TicketTier;
}
