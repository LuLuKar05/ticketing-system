import { injectable, inject } from 'tsyringe';
import { DataSource, QueryFailedError } from 'typeorm';
import { Ticket, TicketStatus } from '../entities/Ticket';
import { ReserveStatus } from '../entities/Reserve';
import { Order, OrderStatus } from '../entities/Order';
import {
    NotFoundError,
    SeatsUnavailableError,
    TicketUnavailableError,
    UserAlreadyHasTicketError,
    ReserveExpiredError,
    ConflictError,
} from '../error';
import { ITicketRepository } from '../repositories/TicketRepository';
import { IReserveRepository } from '../repositories/ReserveRepository';
import { IOrderRepository } from '../repositories/OrderRepository';
import type { IEventBus } from './EventBus';
import { assertConcertSellable } from '../domain/concertRules';

interface IConfirmOrderParams {
    orderId: string;
    userId: string;
}
interface IRefundTicketParams {
    userId: string;
    ticketId: string;
    ticketTierId: string;
}

export interface ITicketService {
    confirmOrder(params: IConfirmOrderParams): Promise<{ order: Order; tickets: Ticket[] }>;
    refundTicket(params: IRefundTicketParams): Promise<void>;
    cancelAllTicketsByConcertId(params: { concertId: string }): Promise<void>;
}

@injectable()
export class TicketService implements ITicketService {
    constructor(
        @inject('AppDataSource') private dataSource: DataSource,
        @inject('IReserveRepository') private reserveRepository: IReserveRepository,
        @inject('ITicketRepository') private ticketRepository: ITicketRepository,
        @inject('IOrderRepository') private orderRepository: IOrderRepository,
        @inject('IEventBus') private eventBus: IEventBus,
    ) {}

    /**
     * Confirm payment for an Order: create the SOLD tickets and confirm the reserves, all in
     * one transaction. All-or-nothing: any failure on any seat rolls back the whole order
     * (no tickets, reserves stay PENDING). There is no stock counter to decrement — capacity
     * is derived from the seat catalog, and Uq_ticket_concert_seat guards double-selling.
     */
    async confirmOrder(params: IConfirmOrderParams): Promise<{ order: Order; tickets: Ticket[] }> {
        const { orderId, userId } = params;
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();
        const manager = queryRunner.manager;
        let order: Order;
        const tickets: Ticket[] = [];
        try {
            const found = await manager.findOne(Order, {
                where: { id: orderId },
                relations: { user: true, reserves: { ticketTier: true, concert: true } },
            });
            if (!found) throw new NotFoundError('Order not found');
            order = found;
            if (order.user.id !== userId) throw new TicketUnavailableError('Order does not belong to this user');

            // Idempotent replay: this order was already confirmed — e.g. a retried or duplicated
            // request (a refresh, a double-click, a client auto-retry after a network blip). Return
            // the tickets confirm already produced instead of erroring or charging twice. orderId is
            // the idempotency key: one order = one payment intent.
            if (order.status === OrderStatus.CONFIRMED) {
                const existing = await this.ticketRepository.findTicketsByOrderId(orderId, manager);
                await queryRunner.commitTransaction();
                return { order, tickets: existing };
            }
            if (order.status !== OrderStatus.PENDING) {
                throw new TicketUnavailableError('Order is not payable (not in a pending state)');
            }
            if (order.reserves.length === 0) throw new TicketUnavailableError('Order has no reserves to confirm');

            // TODO: charge the payment gateway here; only proceed to create tickets on success.

            // The concert must still be open for sales — it may have been cancelled (or reached its
            // date) while this order sat PENDING. Blocks completing payment on a dead concert.
            const concert = order.reserves[0].concert;
            assertConcertSellable(concert);

            // oneTicketPerUser — authoritative re-check against the ticket table.
            if (concert.oneTicketPerUser) {
                if (order.reserves.length > 1) {
                    throw new UserAlreadyHasTicketError('This concert allows only one ticket per user');
                }
                const alreadyOwns = await this.ticketRepository.userHasSoldTicketForConcert(
                    userId,
                    concert.id,
                    manager,
                );
                if (alreadyOwns) throw new UserAlreadyHasTicketError();
            }

            // COMPARE-AND-SET: claim this order for confirmation. Of any racing confirms, exactly one
            // wins (affected=1); the rest see affected=0. Flipping status here (inside the txn) is the
            // explicit single-winner guard — a rollback below reverts it, and the seat unique index
            // stays as a backstop. See OrderRepository.claimOrderForConfirm.
            const claimed = await this.orderRepository.claimOrderForConfirm({ orderId }, manager);
            if (claimed === 0) {
                // Lost the race to a concurrent confirm that committed while we were mid-flight.
                // Re-read: if it's now CONFIRMED for this user, replay idempotently; otherwise the
                // order became unpayable (e.g. cancelled) between our read and the claim.
                const fresh = await manager.findOne(Order, { where: { id: orderId }, relations: { user: true } });
                if (fresh && fresh.status === OrderStatus.CONFIRMED && fresh.user.id === userId) {
                    const existing = await this.ticketRepository.findTicketsByOrderId(orderId, manager);
                    await queryRunner.commitTransaction();
                    return { order: fresh, tickets: existing };
                }
                throw new ConflictError('Order is no longer payable');
            }

            const now = new Date();

            for (const reserve of order.reserves) {
                // The hold must still be valid and unexpired.
                if (reserve.status !== ReserveStatus.PENDING) {
                    throw new TicketUnavailableError('A reserve in this order is no longer valid');
                }
                if (reserve.expiresAt < now) {
                    throw new ReserveExpiredError(`Hold on seat ${reserve.seatNumber} has expired`);
                }

                // Create the SOLD ticket. Uq_ticket_concert_seat is the double-sell backstop:
                // if the seat was sold by someone else, the INSERT throws UNIQUE.
                let ticket: Ticket;
                try {
                    ticket = await this.ticketRepository.createSoldTicket(
                        {
                            concertId: reserve.concert.id,
                            seatNumber: reserve.seatNumber,
                            userId: order.user.id,
                            ticketTierId: reserve.ticketTier.id,
                            pricePaid: reserve.ticketTier.price,
                            orderId: order.id,
                        },
                        manager,
                    );
                } catch (err) {
                    if (err instanceof QueryFailedError && /UNIQUE/i.test(err.message)) {
                        throw new SeatsUnavailableError([reserve.seatNumber], 'sold');
                    }
                    throw err;
                }
                tickets.push(ticket);

                // Confirm the reserve. No stock counter to decrement — capacity is COUNT(seat),
                // and Uq_ticket_concert_seat is the authoritative double-sell guard (above).
                await this.reserveRepository.updateReserveStatus(
                    { id: reserve.id, status: ReserveStatus.CONFIRMED },
                    manager,
                );
            }

            // Status was already flipped by the compare-and-set claim above; only totalAmount is left
            // to persist. Don't manager.save(order) — the in-memory order still reads PENDING from
            // before the claim and would clobber the CONFIRMED status.
            const totalAmount = tickets.reduce((sum, t) => sum + (t.pricePaid ?? 0), 0);
            await manager.update(Order, { id: orderId }, { totalAmount });
            order.status = OrderStatus.CONFIRMED;
            order.totalAmount = totalAmount;

            await queryRunner.commitTransaction();
        } catch (error) {
            await queryRunner.rollbackTransaction();
            throw error;
        } finally {
            await queryRunner.release();
        }

        // Committed — announce the sale to the concert room (all seats share one concert).
        this.eventBus.publishSeatEvent({
            type: 'seat:sold',
            concertId: order.reserves[0].concert.id,
            seatNumbers: tickets.map((t) => t.seatNumber),
        });
        return { order, tickets };
    }

    /**
     * Refund a SOLD ticket: mark it REFUNDED.
     * NOTE: the ticket row remains (status REFUNDED), and Uq_ticket_concert_seat is not partial,
     * so the exact seat can't be re-sold until a future refund phase releases it (delete the row,
     * or make the unique index partial on status='sold').
     */
    async refundTicket(params: IRefundTicketParams): Promise<void> {
        const { userId, ticketId } = params;
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();
        const manager = queryRunner.manager;
        try {
            const ticket = await manager.findOne(Ticket, {
                where: { id: ticketId, status: TicketStatus.SOLD, user: { id: userId } },
            });
            if (!ticket) throw new TicketUnavailableError('Ticket is not eligible for refund');
            ticket.status = TicketStatus.REFUNDED;
            ticket.user = null;
            await manager.save(ticket);
            await queryRunner.commitTransaction();
        } catch (error) {
            await queryRunner.rollbackTransaction();
            throw error;
        } finally {
            await queryRunner.release();
        }
    }

    async cancelAllTicketsByConcertId(params: { concertId: string }): Promise<void> {
        await this.dataSource
            .createQueryBuilder()
            .update(Ticket)
            .set({ status: TicketStatus.CANCELLED, updatedAt: new Date() })
            .where('concertId = :concertId', { concertId: params.concertId })
            .execute();
    }
}
