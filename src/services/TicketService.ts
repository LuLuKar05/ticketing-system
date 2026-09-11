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
    PaymentFailedError,
    ServiceUnavailableError,
} from '../error';
import { ITicketRepository } from '../repositories/TicketRepository';
import { IReserveRepository } from '../repositories/ReserveRepository';
import { IOrderRepository } from '../repositories/OrderRepository';
import { IQueueService } from './QueueService';
import type { IEventBus } from './EventBus';
import { assertConcertSellable } from '../domain/concertRules';
import type { IPaymentGateway } from '../payments/PaymentGateway';
import { logger } from '../observability/logger';

// How long a PAYING claim may sit before another attempt may take it over. This is the recovery
// window for a process that died mid-charge: shorter and a slow gateway gets double-driven, longer
// and a crashed payment blocks the buyer. Re-driving is safe either way — the gateway is keyed on
// the orderId — so this only trades off how quickly a stuck order frees itself.
const claimStaleMs = () => Number(process.env.PAYMENT_CLAIM_STALE_MS ?? 2 * 60 * 1000);
const currency = () => process.env.PAYMENT_CURRENCY ?? 'usd';

/** A hold is only convertible into a ticket while it is still PENDING and unexpired. */
function assertReserveUsable(reserve: { status: ReserveStatus; expiresAt: Date; seatNumber: string }, now: Date): void {
    if (reserve.status !== ReserveStatus.PENDING) {
        throw new TicketUnavailableError('A reserve in this order is no longer valid');
    }
    if (reserve.expiresAt < now) {
        throw new ReserveExpiredError(`Hold on seat ${reserve.seatNumber} has expired`);
    }
}

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
        @inject('IQueueService') private queueService: IQueueService,
        @inject('IPaymentGateway') private paymentGateway: IPaymentGateway,
    ) {}

    /**
     * Confirm payment for an Order — the one flow in this system that spans two systems that cannot
     * share a transaction. Money moves at a payment provider; tickets are rows in Postgres. No ACID
     * boundary covers both, so the sequence is chosen so that every crash point is recoverable:
     *
     *   1. read + validate            (no transaction — nothing is held while we think)
     *   2. CAS  PENDING → PAYING      (committed on its own: a single winner owns the charge, and
     *                                  the state is visible to anyone else who looks)
     *   3. charge the gateway         (no transaction open — never hold DB locks across a network
     *                                  call; idempotencyKey = orderId, so a re-drive is the same
     *                                  charge, not a second one)
     *   4. one transaction            (create SOLD tickets, confirm reserves, PAYING → CONFIRMED
     *                                  with the provider reference) — all-or-nothing
     *
     * Failure handling, in order of how much it costs to get wrong:
     *  - **decline** → hand the claim back (PAYING → PENDING) and throw 402; the hold is still alive
     *    so the buyer can retry with another card.
     *  - **gateway unreachable** → hand the claim back, 503. Nothing was charged.
     *  - **charged, then the ticket write fails** → the only genuinely dangerous case. Refund
     *    (compensation) and release. If the refund ALSO fails, the order is deliberately left in
     *    PAYING with the reference logged: a visible, greppable state for reconciliation, never a
     *    silent loss.
     *  - **crashed mid-charge** → the order sits in PAYING and the next attempt reclaims it once the
     *    claim goes stale, re-driving the same idempotent charge.
     */
    async confirmOrder(params: IConfirmOrderParams): Promise<{ order: Order; tickets: Ticket[] }> {
        const { orderId, userId } = params;

        // ---- 1. Read and validate. Deliberately outside a transaction: everything here is a read,
        // and the gateway call below must not run with one open.
        const order = await this.dataSource.manager.findOne(Order, {
            where: { id: orderId },
            relations: { user: true, reserves: { ticketTier: true, concert: true } },
        });
        if (!order) throw new NotFoundError('Order not found');
        if (order.user.id !== userId) throw new TicketUnavailableError('Order does not belong to this user');

        // Idempotent replay: already confirmed — a retried or duplicated request (a refresh, a
        // double-click, a client auto-retry after a network blip). Return the tickets confirm
        // already produced instead of erroring or charging twice.
        if (order.status === OrderStatus.CONFIRMED) {
            return { order, tickets: await this.ticketRepository.findTicketsByOrderId(orderId) };
        }
        // PAYING is allowed through: the claim below decides whether it is genuinely in flight or a
        // stale claim this attempt may take over.
        if (order.status !== OrderStatus.PENDING && order.status !== OrderStatus.PAYING) {
            throw new TicketUnavailableError('Order is not payable (not in a pending state)');
        }
        if (order.reserves.length === 0) throw new TicketUnavailableError('Order has no reserves to confirm');
        // Pre-charge: a dead or expired hold can be seen now, and refusing here is far better than
        // charging the card and immediately refunding it. Re-checked inside the transaction below,
        // which is the authoritative gate — a hold can still expire while the charge is in flight.
        const readAt = new Date();
        for (const reserve of order.reserves) assertReserveUsable(reserve, readAt);

        // The concert must still be open for sales — it may have been cancelled (or reached its
        // date) while this order sat PENDING. Checked BEFORE the charge: never take money for a
        // concert that can no longer be fulfilled.
        const concert = order.reserves[0].concert;
        assertConcertSellable(concert);

        // oneTicketPerUser — authoritative re-check against the ticket table, also pre-charge.
        if (concert.oneTicketPerUser) {
            if (order.reserves.length > 1) {
                throw new UserAlreadyHasTicketError('This concert allows only one ticket per user');
            }
            if (await this.ticketRepository.userHasSoldTicketForConcert(userId, concert.id)) {
                throw new UserAlreadyHasTicketError();
            }
        }

        // ---- 2. Claim the order for payment (compare-and-set, committed immediately). Of any
        // racing confirms exactly one wins; the losers see PAYING/CONFIRMED and take the replay or
        // conflict branch rather than starting a second charge.
        const claimed = await this.orderRepository.claimOrderForPayment({
            orderId,
            staleAfterMs: claimStaleMs(),
        });
        if (claimed === 0) {
            const fresh = await this.dataSource.manager.findOne(Order, {
                where: { id: orderId },
                relations: { user: true },
            });
            if (fresh?.status === OrderStatus.CONFIRMED && fresh.user.id === userId) {
                return { order: fresh, tickets: await this.ticketRepository.findTicketsByOrderId(orderId) };
            }
            if (fresh?.status === OrderStatus.PAYING) {
                throw new ConflictError('A payment for this order is already in progress');
            }
            throw new ConflictError('Order is no longer payable');
        }

        // ---- 3. Charge. No transaction is open here, by design.
        const amount = order.reserves.reduce((sum, r) => sum + r.ticketTier.price, 0);
        let charge;
        try {
            charge = await this.paymentGateway.charge({
                amount,
                currency: currency(),
                idempotencyKey: orderId, // one order = one payment intent
            });
        } catch (err) {
            await this.releaseClaimQuietly(orderId);
            logger.error({ err, orderId }, 'payment: gateway unreachable — nothing charged, claim released');
            throw new ServiceUnavailableError('The payment provider is unavailable — please retry.');
        }
        if (!charge.success) {
            await this.releaseClaimQuietly(orderId);
            throw new PaymentFailedError(charge.declineReason);
        }
        const paymentRef = charge.reference;

        // ---- 4. Issue the tickets. From here on the money has moved, so any failure below must be
        // compensated rather than merely thrown.
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();
        const manager = queryRunner.manager;
        const tickets: Ticket[] = [];
        const paidAt = new Date();
        try {
            const now = new Date();
            for (const reserve of order.reserves) {
                // Re-checked here, inside the transaction, because a hold can expire while the
                // charge is in flight. The identical check ran pre-charge to avoid taking money we
                // would only have to give back; this one is the authoritative gate.
                assertReserveUsable(reserve, now);

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

            // Settle: PAYING → CONFIRMED with the amount and the provider's reference. Guarded on
            // status='paying', so if our claim was reclaimed while the charge was in flight this
            // affects 0 rows and we unwind rather than overwrite the winner.
            const totalAmount = tickets.reduce((sum, t) => sum + (t.pricePaid ?? 0), 0);
            const settled = await this.orderRepository.markOrderPaid(
                { orderId, totalAmount, paymentRef, paidAt },
                manager,
            );
            if (settled === 0) throw new ConflictError('Payment claim was lost before the order could be settled');

            await queryRunner.commitTransaction();
            order.status = OrderStatus.CONFIRMED;
            order.totalAmount = totalAmount;
            order.paymentRef = paymentRef;
            order.paidAt = paidAt;
        } catch (error) {
            await queryRunner.rollbackTransaction();
            await this.compensateCharge(orderId, paymentRef, error);
            throw error;
        } finally {
            await queryRunner.release();
        }

        // Committed — announce the sale to the concert room (all seats share one concert).
        const concertId = order.reserves[0].concert.id;
        this.eventBus.publishSeatEvent({
            type: 'seat:sold',
            concertId,
            seatNumbers: tickets.map((t) => t.seatNumber),
        });
        // Purchase done → free this buyer's waiting-room slot so the next person is admitted.
        // Best-effort: the queue is fail-open, and the sale is already committed.
        await this.queueService.release(concertId, userId);
        return { order, tickets };
    }

    /**
     * Hand a payment claim back after a failure that charged nothing. Never allowed to throw: the
     * caller is already on its way to reporting a more useful error, and a failed release only means
     * the order waits out the staleness window instead of being retryable immediately.
     */
    private async releaseClaimQuietly(orderId: string): Promise<void> {
        try {
            await this.orderRepository.releasePaymentClaim({ orderId });
        } catch (err) {
            logger.error({ err, orderId }, 'payment: could not release the payment claim');
        }
    }

    /**
     * The money moved but the tickets did not. Undo the charge and free the order.
     *
     * If the refund itself fails there is nothing left to do automatically, and guessing would be
     * worse than stopping: the order stays in PAYING with the reference logged at error level, so
     * the discrepancy is findable rather than invisible. That is the honest boundary of what a
     * compensation path can promise — real systems close it with provider webhooks and a
     * reconciliation job that replays these against the provider's ledger.
     */
    private async compensateCharge(orderId: string, paymentRef: string, cause: unknown): Promise<void> {
        try {
            await this.paymentGateway.refund(paymentRef);
            await this.orderRepository.releasePaymentClaim({ orderId });
            logger.warn({ orderId, paymentRef, err: cause }, 'payment: ticket issue failed after charge — refunded');
        } catch (refundError) {
            logger.error(
                { orderId, paymentRef, err: refundError, cause },
                'payment: REFUND FAILED after a successful charge — order left in PAYING, manual reconciliation required',
            );
        }
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
