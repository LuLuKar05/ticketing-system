import { Repository, EntityManager } from 'typeorm';
import { Order, OrderStatus } from '../entities/Order';
import { inject, injectable } from 'tsyringe';

export interface ICreateOrderParams {
    userId: string;
    status: OrderStatus;
}

export interface IOrderRepository {
    createOrder(data: ICreateOrderParams, manager?: EntityManager): Promise<Order>;
    findOrderById(id: string): Promise<Order | null>;
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
}
