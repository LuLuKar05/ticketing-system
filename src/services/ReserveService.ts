import { injectable, inject } from 'tsyringe';
import { DataSource, QueryFailedError } from 'typeorm';
import { Order, OrderStatus } from '../entities/Order';
import { ReserveStatus } from '../entities/Reserve';
import { UserAlreadyHasTicketError, SeatsUnavailableError, NotFoundError, BadRequestError } from '../error';
import type { IConcertRepository } from '../repositories/ConcertRepository';
import type { IOrderRepository } from '../repositories/OrderRepository';
import type { IReserveRepository } from '../repositories/ReserveRepository';
import type { ITicketRepository } from '../repositories/TicketRepository';
import type { ISeatRepository } from '../repositories/SeatRepository';
import type { IEventBus } from './EventBus';
import { assertConcertSellable } from '../domain/concertRules';

// 5-minute hold window.
const HOLD_TTL_MS = 5 * 60 * 1000;

export interface IReserveServiceParams {
    userId: string;
    concertId: string;
    seats: string[]; // seat numbers; the tier is derived from the seat catalog, never the client
}
export interface IReserveService {
    reserveTickets(params: IReserveServiceParams): Promise<{ order: Order }>;
}

@injectable()
export class ReserveService implements IReserveService {
    constructor(
        @inject('AppDataSource') private dataSource: DataSource,
        @inject('IConcertRepository') private concertRepository: IConcertRepository,
        @inject('IOrderRepository') private orderRepository: IOrderRepository,
        @inject('IReserveRepository') private reserveRepository: IReserveRepository,
        @inject('ITicketRepository') private ticketRepository: ITicketRepository,
        @inject('ISeatRepository') private seatRepository: ISeatRepository,
        @inject('IEventBus') private eventBus: IEventBus,
    ) {}

    /**
     * Acquire an exclusive hold on the requested seats:
     *  - one Order + one PENDING Reserve per seat, all-or-nothing,
     *  - each seat's tier is DERIVED from the seat catalog (not the request) — this closes the
     *    tier-swap price exploit and rejects seats that don't exist,
     *  - exclusivity enforced by the Uqi_reserve_concert_seat partial-unique index.
     */
    async reserveTickets(params: IReserveServiceParams): Promise<{ order: Order }> {
        const { userId, concertId, seats: seatNumbers } = params;

        // 1. Concert must exist and be open for sales (not cancelled/past). Fail fast, pre-txn.
        const concert = await this.concertRepository.findConcertById(concertId);
        if (!concert) throw new NotFoundError('Concert not found');
        assertConcertSellable(concert);
        if (concert.oneTicketPerUser && seatNumbers.length > 1) {
            throw new UserAlreadyHasTicketError('This concert allows only one ticket per user');
        }

        let order: Order;
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();
        const manager = queryRunner.manager;
        try {
            // 2. oneTicketPerUser: user must not already OWN a ticket for this concert.
            if (concert.oneTicketPerUser) {
                const alreadyOwns = await this.ticketRepository.userHasSoldTicketForConcert(userId, concertId, manager);
                if (alreadyOwns) throw new UserAlreadyHasTicketError();
            }

            // 3. Resolve seats against the catalog. The tier comes from the seat, and any seat that
            //    isn't in the catalog is rejected (no more free-form seat labels).
            const catalogSeats = await this.seatRepository.findSeatsByNumbers(concertId, seatNumbers, manager);
            const seatByNumber = new Map(catalogSeats.map((s) => [s.seatNumber, s]));
            const unknown = seatNumbers.filter((n) => !seatByNumber.has(n));
            if (unknown.length > 0) {
                throw new BadRequestError(`Unknown seat(s) for this concert: ${unknown.join(', ')}`);
            }

            // 3.5. Reap expired holds on exactly these seats before pre-checking/inserting. The 60s
            //      sweeper does this globally; doing it inline here means an expired-but-unswept hold
            //      can't block this fresh hold (and can't collide with the INSERT below).
            await this.reserveRepository.cancelExpiredReservesForSeats(concertId, seatNumbers, new Date(), manager);

            // 4. Pre-check: surface every unavailable seat at once (sold takes priority over held).
            const soldSeats = await this.ticketRepository.findSoldSeatNumbers(concertId, seatNumbers, manager);
            if (soldSeats.length > 0) throw new SeatsUnavailableError(soldSeats, 'sold');
            const heldSeats = await this.reserveRepository.findHeldSeatNumbers(concertId, seatNumbers, manager);
            if (heldSeats.length > 0) throw new SeatsUnavailableError(heldSeats, 'held');

            // 5. Create the Order (parent of the holds).
            order = await this.orderRepository.createOrder({ userId, status: OrderStatus.PENDING }, manager);

            // 6. Insert one PENDING reserve per seat, tier taken from the catalog. The unique index
            //    is the race backstop: a seat held between the pre-check and here throws.
            const expiresAt = new Date(Date.now() + HOLD_TTL_MS);
            for (const seatNumber of seatNumbers) {
                const seat = seatByNumber.get(seatNumber)!;
                try {
                    await this.reserveRepository.createReserve(
                        {
                            userId,
                            concertId,
                            tierId: seat.ticketTier.id,
                            seatNumber,
                            orderId: order.id,
                            status: ReserveStatus.PENDING,
                            expiresAt,
                        },
                        manager,
                    );
                } catch (err) {
                    if (err instanceof QueryFailedError && /UNIQUE/i.test(err.message)) {
                        throw new SeatsUnavailableError([seatNumber], 'held');
                    }
                    throw err;
                }
            }

            await queryRunner.commitTransaction();
        } catch (err) {
            await queryRunner.rollbackTransaction();
            throw err;
        } finally {
            await queryRunner.release();
        }

        // Committed — safe to announce. (Reached only on success; the catch above re-throws.)
        this.eventBus.publishSeatEvent({ type: 'seat:held', concertId, seatNumbers });
        return { order };
    }
}
