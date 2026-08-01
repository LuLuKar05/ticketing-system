import { Repository, EntityManager, LessThan } from 'typeorm';
import { Reserve, ReserveStatus } from '../entities/Reserve';
import { inject, injectable } from 'tsyringe';

export interface ICreateReserveParams {
    userId: string;
    concertId: string;
    tierId: string;
    seatNumber: string;
    orderId: string;
    status: ReserveStatus;
    expiresAt: Date;
}
export interface IUpdateReserveStatusParams {
    id: string;
    status: ReserveStatus;
}

export interface IReserveRepository {
    findReserveById(id: string): Promise<Reserve | null>;
    createReserve(data: ICreateReserveParams, manager?: EntityManager): Promise<Reserve>;
    /** Of the requested seatNumbers, which currently have a PENDING, UNEXPIRED hold for this concert. */
    findHeldSeatNumbers(concertId: string, seatNumbers: string[], manager?: EntityManager): Promise<string[]>;
    updateReserveStatus(params: IUpdateReserveStatusParams, manager?: EntityManager): Promise<void>;
    /** Bulk-cancel every PENDING reserve whose hold has expired. Returns rows affected. */
    cancelExpiredReserves(now: Date, manager?: EntityManager): Promise<number>;
    /** Cancel expired PENDING holds for JUST these seats — reap before a fresh hold grabs them. */
    cancelExpiredReservesForSeats(
        concertId: string,
        seatNumbers: string[],
        now: Date,
        manager?: EntityManager,
    ): Promise<number>;
    /** Seat identities of expired PENDING reserves — call BEFORE cancelling to know what freed. */
    findExpiredPendingSeats(now: Date, manager?: EntityManager): Promise<{ concertId: string; seatNumber: string }[]>;
    deleteReserve(id: string): Promise<void>;
}

@injectable()
export class ReserveRepository implements IReserveRepository {
    constructor(@inject('ReserveTypeOrmRepo') private repo: Repository<Reserve>) {}

    async findReserveById(id: string): Promise<Reserve | null> {
        return this.repo.findOneBy({ id });
    }

    // manager-aware: enlists the INSERT in the caller's transaction when a manager is passed.
    async createReserve(data: ICreateReserveParams, manager?: EntityManager): Promise<Reserve> {
        const repo = manager ? manager.getRepository(Reserve) : this.repo;
        const reserve = repo.create({
            user: { id: data.userId },
            concert: { id: data.concertId },
            ticketTier: { id: data.tierId },
            order: { id: data.orderId },
            seatNumber: data.seatNumber,
            status: data.status,
            expiresAt: data.expiresAt,
        });
        return repo.save(reserve);
    }

    async findHeldSeatNumbers(concertId: string, seatNumbers: string[], manager?: EntityManager): Promise<string[]> {
        if (seatNumbers.length === 0) return [];
        const repo = manager ? manager.getRepository(Reserve) : this.repo;
        // Only UNEXPIRED pending holds count. Without the expiresAt filter, an expired-but-unswept
        // hold would (a) block a fresh hold for up to a sweeper cycle and (b) make the seat-map read
        // model report a free seat as `held` — the exact staleness the read model exists to prevent.
        const rows = await repo
            .createQueryBuilder('reserve')
            .select('reserve.seatNumber', 'seatNumber')
            .where('reserve.concert = :concertId', { concertId })
            .andWhere('reserve.seatNumber IN (:...seatNumbers)', { seatNumbers })
            .andWhere('reserve.status = :status', { status: ReserveStatus.PENDING })
            .andWhere('reserve.expiresAt > :now', { now: new Date() })
            .getRawMany<{ seatNumber: string }>();
        return rows.map((r) => r.seatNumber);
    }

    async updateReserveStatus(params: IUpdateReserveStatusParams, manager?: EntityManager): Promise<void> {
        const repo = manager ? manager.getRepository(Reserve) : this.repo;
        await repo.update(params.id, { status: params.status });
    }

    // Single atomic UPDATE (uses Idx_reserve_status). Cancelling frees the seat automatically
    // because Uqi_reserve_concert_seat only covers status='pending'. Status-only, no deletes.
    async cancelExpiredReserves(now: Date, manager?: EntityManager): Promise<number> {
        const repo = manager ? manager.getRepository(Reserve) : this.repo;
        const result = await repo
            .createQueryBuilder()
            .update(Reserve)
            .set({ status: ReserveStatus.CANCELLED })
            .where('status = :status', { status: ReserveStatus.PENDING })
            .andWhere('expiresAt < :now', { now })
            .execute();
        return result.affected ?? 0;
    }

    // Seat-scoped reap: cancel expired PENDING holds for JUST these seats. Called inside the hold
    // transaction so an expired-but-unswept hold doesn't collide with the fresh reserve INSERT
    // (the reserve unique index only covers status='pending', so cancelling frees the slot).
    async cancelExpiredReservesForSeats(
        concertId: string,
        seatNumbers: string[],
        now: Date,
        manager?: EntityManager,
    ): Promise<number> {
        if (seatNumbers.length === 0) return 0;
        const repo = manager ? manager.getRepository(Reserve) : this.repo;
        const result = await repo
            .createQueryBuilder()
            .update(Reserve)
            .set({ status: ReserveStatus.CANCELLED })
            .where('concertId = :concertId', { concertId })
            .andWhere('seatNumber IN (:...seatNumbers)', { seatNumbers })
            .andWhere('status = :status', { status: ReserveStatus.PENDING })
            .andWhere('expiresAt < :now', { now })
            .execute();
        return result.affected ?? 0;
    }

    // Uses the SAME `now` the sweeper passes to cancelExpiredReserves, in the same transaction,
    // so the seats returned here are exactly the ones that get cancelled (single-writer SQLite).
    // `select` loads only concert.id, not the whole concert.
    async findExpiredPendingSeats(
        now: Date,
        manager?: EntityManager,
    ): Promise<{ concertId: string; seatNumber: string }[]> {
        const repo = manager ? manager.getRepository(Reserve) : this.repo;
        const rows = await repo.find({
            where: { status: ReserveStatus.PENDING, expiresAt: LessThan(now) },
            relations: { concert: true },
            select: { seatNumber: true, concert: { id: true } },
        });
        return rows.map((r) => ({ concertId: r.concert.id, seatNumber: r.seatNumber }));
    }

    async deleteReserve(id: string): Promise<void> {
        await this.repo.delete(id);
    }
}
