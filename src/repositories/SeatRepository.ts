import { Repository, EntityManager, In } from 'typeorm';
import { Seat } from '../entities/Seat';
import { inject, injectable } from 'tsyringe';

export interface INewSeat {
    seatNumber: string;
    section?: string | null;
    rowLabel?: string | null;
    tierId: string;
}
export interface ISeatCount {
    tierId: string;
    count: number;
}

export interface ISeatRepository {
    /** All seats of a concert (with their tier) — the layout for the availability read model. */
    findSeatsForConcert(concertId: string, manager?: EntityManager): Promise<Seat[]>;
    /** The catalog rows for specific seat labels — used by the hold path to derive each seat's tier. */
    findSeatsByNumbers(concertId: string, seatNumbers: string[], manager?: EntityManager): Promise<Seat[]>;
    /** Full-replace a concert's seat catalog (admin import), inside the caller's transaction. */
    replaceSeats(concertId: string, seats: INewSeat[], manager?: EntityManager): Promise<void>;
    /** Seat count per tier = that tier's capacity (there is no stored quantity). */
    countSeatsByTier(concertId: string, manager?: EntityManager): Promise<ISeatCount[]>;
}

@injectable()
export class SeatRepository implements ISeatRepository {
    constructor(@inject('SeatTypeOrmRepo') private repo: Repository<Seat>) {}

    async findSeatsForConcert(concertId: string, manager?: EntityManager): Promise<Seat[]> {
        const repo = manager ? manager.getRepository(Seat) : this.repo;
        return repo.find({
            where: { concert: { id: concertId } },
            relations: { ticketTier: true },
            order: { seatNumber: 'ASC' },
        });
    }

    async findSeatsByNumbers(concertId: string, seatNumbers: string[], manager?: EntityManager): Promise<Seat[]> {
        if (seatNumbers.length === 0) return [];
        const repo = manager ? manager.getRepository(Seat) : this.repo;
        return repo.find({
            where: { concert: { id: concertId }, seatNumber: In(seatNumbers) },
            relations: { ticketTier: true },
        });
    }

    async replaceSeats(concertId: string, seats: INewSeat[], manager?: EntityManager): Promise<void> {
        const repo = manager ? manager.getRepository(Seat) : this.repo;
        // Wipe the concert's existing layout, then insert the new one (guarded upstream: the
        // caller rejects the import if any seat is already sold/held — see SeatService).
        await repo.createQueryBuilder().delete().from(Seat).where('concertId = :concertId', { concertId }).execute();
        if (seats.length === 0) return;
        const rows = seats.map((s) =>
            repo.create({
                seatNumber: s.seatNumber,
                section: s.section ?? null,
                rowLabel: s.rowLabel ?? null,
                concert: { id: concertId },
                ticketTier: { id: s.tierId },
            }),
        );
        await repo.save(rows);
    }

    async countSeatsByTier(concertId: string, manager?: EntityManager): Promise<ISeatCount[]> {
        const repo = manager ? manager.getRepository(Seat) : this.repo;
        const rows = await repo
            .createQueryBuilder('seat')
            .leftJoin('seat.ticketTier', 'tier')
            .select('tier.id', 'tierId')
            .addSelect('COUNT(*)', 'count')
            .where('seat.concert = :concertId', { concertId })
            .groupBy('tier.id')
            .getRawMany<{ tierId: string; count: string | number }>();
        return rows.map((r) => ({ tierId: r.tierId, count: Number(r.count) }));
    }
}
