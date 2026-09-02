import { Entity, Column, OneToMany, Index } from 'typeorm';
import { TicketTier } from './TicketTier';
import { AbstractEntity } from './AbstractEntity';

/**
 * COncert Entity: represents a concert, including its name, date, description, image, location, artists, genres, total tickets, duration, age restriction, and status.
 * It also has relations to tickets and ticket tiers.
 *
 * Indexing Strategy:
 * 1. Idx_concert_location: B-Tree Index on location, used for retrieving concerts based on their location.
 * This is useful for users searching for concerts in a specific area.
 *
 * 2. Idx_sorted_concert_status: B-Tree Index on (status, concertDate), used for retrieving concerts based on their status and date.
 * This is useful for users searching for concerts that are upcoming, ongoing, or past.
 *
 * 3. Idx_concert_date: B-Tree Index on concertDate, used for retrieving concerts based on their date.
 * This is useful for users searching for concerts on a specific date or within a date range.
 *
 * Upcoming Indexing Strategy:
 * 1. GIN Index on name: This index allows for efficient searching of concerts by name, which is useful for users looking for specific concerts.
 * 2. GIN Index on artist: This index allows for efficient searching of concerts by artist names, which is useful for users looking for concerts featuring specific artists.
 * 3. GIN Index on genre: This index allows for efficient searching of concerts by genre, which is useful for users looking for concerts in a specific music genre.
 */
export enum ConcertStatus {
    UPCOMING = 'upcoming',
    ONGOING = 'ongoing',
    PAST = 'past',
    CANCELLED = 'cancelled',
    RESCHEDULED = 'rescheduled',
}
@Entity()
@Index('Idx_concert_location', ['location'])
@Index('Idx_sorted_concert_status', ['status', 'concertDate'])
@Index('Idx_concert_date', ['concertDate'])
export class Concert extends AbstractEntity {
    @Column()
    name!: string;
    @Column()
    concertDate!: Date;
    // varchar (not text) so the 1000 length is portable — Postgres text has no length property.
    @Column({ type: 'varchar', length: 1000 })
    description!: string;
    @Column()
    imageUrl!: string;
    @Column()
    location!: string;

    @Column({ type: 'simple-array' })
    artist!: string[];
    @Column({ type: 'simple-array' })
    genre!: string[];

    //Ticketing info
    @Column()
    totalTickets!: number;

    //Additional fields
    @Column()
    duration!: number;
    @Column()
    ageRestriction!: number;
    @Column({ default: false })
    oneTicketPerUser!: boolean;
    // High-demand on-sale: when true, buyers must be admitted through the waiting-room queue before
    // they can hold seats (POST /reserves). Read by requireActivePass; off for ordinary concerts.
    @Column({ default: false })
    gatedOnSale!: boolean;
    // NOTE: assigned-vs-GA seating mode is NOT stored — a flag with no reader is a lie (see SEATMAP.md
    // §10). When general-admission auto-assign is actually built, re-add the column with its code path.
    @Column({ type: 'text', default: ConcertStatus.UPCOMING })
    status!: ConcertStatus;

    //Relations — concert owns its tiers. Tickets/Reserves reference the concert
    //one-directionally (no inverse here) since they're queried by their own FKs.
    @OneToMany(() => TicketTier, (ticketTier) => ticketTier.concert)
    ticketTiers!: TicketTier[];
}
