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
     * Atomically claim a PENDING order for confirmation (compare-and-set): flip status
     * PENDING → CONFIRMED only if it is still PENDING. Returns rows affected — 1 means this
     * caller won, 0 means someone else already confirmed it. The single-winner guard for
     * confirmOrder; see TicketService.confirmOrder.
     */
    claimOrderForConfirm(params: { orderId: string }, manager?: EntityManager): Promise<number>;
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

    // Compare-and-set on status. The WHERE status='pending' predicate is the concurrency guard:
    // two racing confirms both try this UPDATE; Postgres serializes them on the row, and only the
    // first sees status='pending' (affected=1). The loser re-reads status='confirmed' → affected=0.
    async claimOrderForConfirm(params: { orderId: string }, manager?: EntityManager): Promise<number> {
        const repo = manager ? manager.getRepository(Order) : this.repo;
        const result = await repo
            .createQueryBuilder()
            .update(Order)
            .set({ status: OrderStatus.CONFIRMED })
            .where('id = :orderId AND status = :pending', {
                orderId: params.orderId,
                pending: OrderStatus.PENDING,
            })
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
