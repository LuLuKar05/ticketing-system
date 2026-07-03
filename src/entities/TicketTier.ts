import{ Entity,
        Index,
        Unique,
        Column,
        ManyToOne,
    } from 'typeorm';
import { AbstractEntity } from './AbstractEntity';
import { Concert } from './Concert';

/**
 * 
 * TicketTier Entity: represents a tier of tickets for a concert, associated with a specific concert. 
 * It includes information about the name, price, and quantity of tickets in that tier.
 * 
 * Indexing Strategy:
 * 1. Idx_ticket_tier_price:        B-Tree Index on price, used for retrieving ticket tiers based on price. 
 * This is used for retriveing ticket tier based on price, which is useful for users looking for tiers within a specific budget.
 * 
 * 2. Idx_ticket_tier_quantity:     B-Tree Index on quantity, used for retrieving ticket tiers based on available quantity. 
 * This is useful for quickly identifying ticket tiers that are sold out or have limited availability.
 * 
 * 3. Uq_ticket_tier_concert_name:  Unique index on (concert, name), used to ensure that each ticket tier name is unique within a concert.
 * This prevents duplicate tier names for the same concert.
 * 
 * 4. Idx_ticket_tier_concert:      B-Tree Index on concert, used for retrieving all ticket tiers associated with a specific concert.
 * This is useful for displaying all available ticket tiers for a concert and for generating concert-specific reports.
*/
@Entity()
@Unique("Uq_ticket_tier_concert_name",['concert', 'name'])
@Index("Idx_ticket_tier_price", ["price"])
@Index("Idx_ticket_tier_quantity", ["quantity"])

export class TicketTier extends AbstractEntity{
    @Column({type: 'text'})
    name!: string;
    @Column({type: 'int'})
    price!: number;
    @Column({type: 'int'})
    quantity!: number;

    @ManyToOne(() => Concert, concert => concert.ticketTiers)
    concert!: Concert;
}