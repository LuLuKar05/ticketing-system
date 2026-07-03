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
} from '../error';
import { ITicketRepository } from '../repositories/TicketRepository';
import { ITicketTierRepository } from '../repositories/TicketTierRepository';
import { IReserveRepository } from '../repositories/ReserveRepository';

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
        @inject('ITicketTierRepository') private ticketTierRepository: ITicketTierRepository,
    ) {}

    /**
     * Confirm payment for an Order: create the SOLD tickets, confirm the reserves, and
     * decrement tier stock — all in one transaction. All-or-nothing: any failure on any
     * seat rolls back the whole order (no tickets, no stock change, reserves stay PENDING).
     */
    async confirmOrder(params: IConfirmOrderParams): Promise<{ order: Order; tickets: Ticket[] }> {
        const { orderId, userId } = params;
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();
        const manager = queryRunner.manager;
        try {
            const order = await manager.findOne(Order, {
                where: { id: orderId },
                relations: { user: true, reserves: { ticketTier: true, concert: true } },
            });
            if (!order) throw new NotFoundError('Order not found');
            if (order.status !== OrderStatus.PENDING) {
                throw new TicketUnavailableError('Order is not payable (not in a pending state)');
            }
            if (order.user.id !== userId) throw new TicketUnavailableError('Order does not belong to this user');
            if (order.reserves.length === 0) throw new TicketUnavailableError('Order has no reserves to confirm');

            // TODO: charge the payment gateway here; only proceed to create tickets on success.

            // oneTicketPerUser — authoritative re-check against the ticket table.
            const concert = order.reserves[0].concert;
            if (concert.oneTicketPerUser) {
                if (order.reserves.length > 1) {
                    throw new UserAlreadyHasTicketError('This concert allows only one ticket per user');
                }
                const alreadyOwns = await this.ticketRepository.userHasSoldTicketForConcert(userId, concert.id, manager);
                if (alreadyOwns) throw new UserAlreadyHasTicketError();
            }

            const now = new Date();
            const tickets: Ticket[] = [];

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

                // Decrement tier stock (guarded; throws if sold out) and confirm the reserve.
                await this.ticketTierRepository.decrementQuantity(reserve.ticketTier.id, 1, manager);
                await this.reserveRepository.updateReserveStatus({ id: reserve.id, status: ReserveStatus.CONFIRMED }, manager);
            }

            order.status = OrderStatus.CONFIRMED;
            order.totalAmount = tickets.reduce((sum, t) => sum + (t.pricePaid ?? 0), 0);
            await manager.save(order);

            await queryRunner.commitTransaction();
            return { order, tickets };
        } catch (error) {
            await queryRunner.rollbackTransaction();
            throw error;
        } finally {
            await queryRunner.release();
        }
    }

    /**
     * Refund a SOLD ticket: mark it REFUNDED and return the seat to the tier's stock.
     * NOTE: the ticket row remains (status REFUNDED), and Uq_ticket_concert_seat is not
     * partial, so the exact seat can't be re-sold until a future refund phase handles
     * seat release (delete the row or make the unique index partial on status='sold').
     */
    async refundTicket(params: IRefundTicketParams): Promise<void> {
        const { userId, ticketId, ticketTierId } = params;
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
            await this.ticketTierRepository.incrementQuantity(ticketTierId, 1, manager);
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
