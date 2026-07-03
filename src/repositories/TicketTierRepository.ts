import {EntityManager, MoreThan, Repository} from 'typeorm';
import {TicketTier} from '../entities/TicketTier';
import {inject, injectable} from 'tsyringe';
import { TicketUnavailableError } from '../error';

export interface ITicketTierRepository {
    incrementQuantity(ticketTierId: string, incrementBy: number, manager?: EntityManager): Promise<void>;
    decrementQuantity(ticketTierId: string, decrementBy: number, manager?: EntityManager): Promise<void>;
}

@injectable()
export class TicketTierRepository implements ITicketTierRepository{
    constructor(@inject('TicketTierTypeOrmRepo') private repo: Repository<TicketTier>){}
    async incrementQuantity(ticketTierId: string, incrementBy: number, manager?: EntityManager): Promise<void>{
        const res = manager ?? this.repo.manager;
        const result = await res.update(TicketTier,
            { id: ticketTierId}, 
            { quantity: () => `quantity + ${incrementBy}` });
        if((result as any).affected !== 1) throw new TicketUnavailableError('Failed to increment quantity, ticket tier not found or quantity is already zero');
    }
    async decrementQuantity(ticketTierId: string, decrementBy: number, manager?: EntityManager): Promise<void>{
        const res = manager ?? this.repo.manager;
        const result = await res.update(TicketTier, { id: ticketTierId, quantity: MoreThan(0) }, { quantity: () => `quantity - ${decrementBy}` });
        if((result as any).affected !== 1) throw new TicketUnavailableError('Failed to decrement quantity, ticket tier not found or quantity is already zero');
    }
}