import { injectable, inject } from 'tsyringe';
import { DataSource, QueryFailedError } from 'typeorm';
import { Order, OrderStatus } from '../entities/Order';
import { ReserveStatus } from '../entities/Reserve';
import {
    UserAlreadyHasTicketError,
    SeatsUnavailableError,
    NotFoundError,
} from '../error';
import type { IConcertRepository } from '../repositories/ConcertRepository';
import type { IOrderRepository } from '../repositories/OrderRepository';
import type { IReserveRepository } from '../repositories/ReserveRepository';
import type { ITicketRepository } from '../repositories/TicketRepository';
import type { IEventBus } from './EventBus';

// 5-minute hold window.
const HOLD_TTL_MS = 5 * 60 * 1000;

export interface ISeatSelection {
    tierId: string;
    seatNumber: string;
}
export interface IReserveServiceParams {
    userId: string;
    concertId: string;
    seats: ISeatSelection[];
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
        @inject('IEventBus') private eventBus: IEventBus,
    ) {}

    /**
     * Acquire an exclusive hold on the requested seats:
     *  - one Order + one PENDING Reserve per seat, all-or-nothing,
     *  - exclusivity enforced by the Uqi_reserve_concert_seat partial-unique index,
     *  - a pre-check reports ALL already-sold/held seats up front (good UX).
     */
    async reserveTickets(params: IReserveServiceParams): Promise<{ order: Order }> {
        const { userId, concertId, seats } = params;
        const seatNumbers = seats.map((s) => s.seatNumber);

        // 1. Concert must exist. oneTicketPerUser => at most one seat per order.
        const concert = await this.concertRepository.findConcertById(concertId);
        if (!concert) throw new NotFoundError('Concert not found');
        if (concert.oneTicketPerUser && seats.length > 1) {
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

            // 3. Pre-check: surface every unavailable seat at once (sold takes priority over held).
            const soldSeats = await this.ticketRepository.findSoldSeatNumbers(concertId, seatNumbers, manager);
            if (soldSeats.length > 0) throw new SeatsUnavailableError(soldSeats, 'sold');
            const heldSeats = await this.reserveRepository.findHeldSeatNumbers(concertId, seatNumbers, manager);
            if (heldSeats.length > 0) throw new SeatsUnavailableError(heldSeats, 'held');

            // 4. Create the Order (parent of the holds).
            order = await this.orderRepository.createOrder({ userId, status: OrderStatus.PENDING }, manager);

            // 5. Insert one PENDING reserve per seat. The unique index is the race backstop:
            //    if a seat was held between the pre-check and here, the INSERT throws.
            const expiresAt = new Date(Date.now() + HOLD_TTL_MS);
            for (const seat of seats) {
                try {
                    await this.reserveRepository.createReserve(
                        {
                            userId,
                            concertId,
                            tierId: seat.tierId,
                            seatNumber: seat.seatNumber,
                            orderId: order.id,
                            status: ReserveStatus.PENDING,
                            expiresAt,
                        },
                        manager,
                    );
                } catch (err) {
                    if (err instanceof QueryFailedError && /UNIQUE/i.test(err.message)) {
                        throw new SeatsUnavailableError([seat.seatNumber], 'held');
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
