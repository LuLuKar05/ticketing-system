import { Repository, EntityManager } from 'typeorm';
import { Order, OrderStatus } from '../entities/Order';
import { ReserveStatus } from '../entities/Reserve';
import { inject, injectable } from 'tsyringe';

export interface ICreateOrderParams {
    userId: string;
    status: OrderStatus;
}
interface IFindOrderForConfirmParams {
    orderId: string;
    userId: string;
}
export interface IOrderRepository {
    createOrder(data: ICreateOrderParams, manager?: EntityManager): Promise<Order>;
    findOrderById(id: string): Promise<Order | null>;
    findOrderForConfirm(params: IFindOrderForConfirmParams, manager?: EntityManager): Promise<Order | null>;
    /**
     * Atomically claim an order for payment (compare-and-set): flip status PENDING → PAYING.
     * Returns rows affected — 1 means this caller won and owns the charge, 0 means someone else
     * is already paying (or the order is no longer payable). The single-winner guard for
     * confirmOrder; see TicketService.confirmOrder.
     *
     * `staleAfterMs` also lets a PAYING order be re-claimed once it has sat there longer than that
     * — the recovery path for a process that died mid-charge. Re-charging is safe because the
     * gateway is keyed on the orderId, so the retry resolves to the SAME charge, not a second one.
     */
    claimOrderForPayment(params: { orderId: string; staleAfterMs: number }, manager?: EntityManager): Promise<number>;
    /** Hand the claim back (PAYING → PENDING) after a decline, so the buyer can retry. */
    releasePaymentClaim(params: { orderId: string }, manager?: EntityManager): Promise<number>;
    /** Settle a paid order: PAYING → CONFIRMED with the amount and the provider's reference. */
    markOrderPaid(
        params: { orderId: string; totalAmount: number; paymentRef: string; paidAt: Date },
        manager?: EntityManager,
    ): Promise<number>;
    /** Cancel PENDING orders that no longer have any PENDING reserve. Returns rows affected. */
    cancelStalePendingOrders(manager?: EntityManager): Promise<number>;
}

@injectable()
export class OrderRepository implements IOrderRepository {
    constructor(@inject('OrderTypeOrmRepo') private repo: Repository<Order>) {}

    // manager-aware: pass the transaction's manager to enlist this write in it.
    async createOrder(data: ICreateOrderParams, manager?: EntityManager): Promise<Order> {
        const repo = manager ? manager.getRepository(Order) : this.repo;
        const order = repo.create({ user: { id: data.userId }, status: data.status });
        return repo.save(order);
    }

    async findOrderById(id: string): Promise<Order | null> {
        return this.repo.findOne({ where: { id }, relations: { reserves: true } });
    }

    async findOrderForConfirm(params: IFindOrderForConfirmParams, manager?: EntityManager): Promise<Order | null> {
        const { orderId, userId } = params;
        const repo = manager ? manager.getRepository(Order) : this.repo;
        return repo.findOne({
            where: { id: orderId, user: { id: userId } },
            relations: { user: true, reserves: true },
        });
    }

    // Compare-and-set on status. The WHERE predicate is the concurrency guard: two racing confirms
    // both try this UPDATE; Postgres serializes them on the row, and only the first sees a claimable
    // status (affected=1). The loser sees 'paying'/'confirmed' → affected=0 and takes the replay or
    // conflict branch. The second disjunct reclaims a charge abandoned by a dead process.
    async claimOrderForPayment(
        params: { orderId: string; staleAfterMs: number },
        manager?: EntityManager,
    ): Promise<number> {
        const repo = manager ? manager.getRepository(Order) : this.repo;
        const result = await repo
            .createQueryBuilder()
            .update(Order)
            // updatedAt is set explicitly: it doubles as the claim's timestamp, which the staleness
            // predicate above reads, so it must move on every claim.
            .set({ status: OrderStatus.PAYING, updatedAt: new Date() })
            .where('id = :orderId', { orderId: params.orderId })
            .andWhere('(status = :pending OR (status = :paying AND "updatedAt" < :staleBefore))', {
                pending: OrderStatus.PENDING,
                paying: OrderStatus.PAYING,
                staleBefore: new Date(Date.now() - params.staleAfterMs),
            })
            .execute();
        return result.affected ?? 0;
    }

    async releasePaymentClaim(params: { orderId: string }, manager?: EntityManager): Promise<number> {
        const repo = manager ? manager.getRepository(Order) : this.repo;
        const result = await repo
            .createQueryBuilder()
            .update(Order)
            .set({ status: OrderStatus.PENDING, updatedAt: new Date() })
            .where('id = :orderId AND status = :paying', { orderId: params.orderId, paying: OrderStatus.PAYING })
            .execute();
        return result.affected ?? 0;
    }

    // Guarded on status='paying' as well: only the claim holder can settle the order, so a stale
    // caller that lost its claim to the staleness reclaim above cannot overwrite the winner's result.
    async markOrderPaid(
        params: { orderId: string; totalAmount: number; paymentRef: string; paidAt: Date },
        manager?: EntityManager,
    ): Promise<number> {
        const repo = manager ? manager.getRepository(Order) : this.repo;
        const result = await repo
            .createQueryBuilder()
            .update(Order)
            .set({
                status: OrderStatus.CONFIRMED,
                totalAmount: params.totalAmount,
                paymentRef: params.paymentRef,
                paidAt: params.paidAt,
                updatedAt: new Date(),
            })
            .where('id = :orderId AND status = :paying', { orderId: params.orderId, paying: OrderStatus.PAYING })
            .execute();
        return result.affected ?? 0;
    }

    // A PENDING order whose reserves are all gone (expired/cancelled) is dead → cancel it.
    // Run AFTER cancelExpiredReserves so the subquery reflects the just-cancelled holds.
    async cancelStalePendingOrders(manager?: EntityManager): Promise<number> {
        const repo = manager ? manager.getRepository(Order) : this.repo;
        const result = await repo
            .createQueryBuilder()
            .update(Order)
            .set({ status: OrderStatus.CANCELLED })
            .where('status = :orderStatus', { orderStatus: OrderStatus.PENDING })
            .andWhere(
                'id NOT IN (SELECT DISTINCT r."orderId" FROM "reserve" r WHERE r.status = :pending AND r."orderId" IS NOT NULL)',
                { pending: ReserveStatus.PENDING },
            )
            .execute();
        return result.affected ?? 0;
    }
}
