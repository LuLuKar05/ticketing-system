import { AppDataSource } from './data-source';
import { Concert } from './entities/Concert';
import { Ticket } from './entities/Ticket';
import { Reserve } from './entities/Reserve';
import { TicketTier } from './entities/TicketTier';
import { User } from './entities/User';
import { Order } from './entities/Order';

import { ConcertController } from './controllers/ConcertController';
import { ReserveController } from './controllers/ReserveController';
import { UserController } from './controllers/UserController';
import { TicketController } from './controllers/TicketController';
import { ConcertRepository } from './repositories/ConcertRepository';
import { ReserveRepository } from './repositories/ReserveRepository';
import { TicketRepository } from './repositories/TicketRepository';
import { OrderRepository } from './repositories/OrderRepository';
import {UserRepository} from './repositories/UserRepository';

import { ConcertService } from './services/ConcertService';
import { ReserveService } from './services/ReserveService';
import { TicketService } from './services/TicketService';

import {container} from 'tsyringe';

export function registerDependencies(){

    container.register('AppDataSource', { useValue: AppDataSource});

    ///conatiner.register('ITicketTierRepository', { useClass: TicketTierRepository });

    container.register('ConcertTypeOrmRepo', { useValue: AppDataSource.getRepository(Concert) });
    container.register('ReserveTypeOrmRepo', { useValue: AppDataSource.getRepository(Reserve) });
    container.register('TicketTypeOrmRepo',  { useValue: AppDataSource.getRepository(Ticket) });
    container.register('UserTypeOrmRepo', { useValue: AppDataSource.getRepository(User) });
    container.register('TicketTierTypeOrmRepo', { useValue: AppDataSource.getRepository(TicketTier) });
    container.register('OrderTypeOrmRepo', { useValue: AppDataSource.getRepository(Order) });

    container.register('IConcertRepository', { useClass: ConcertRepository });
    container.register('IConcertService',    { useClass: ConcertService });
    container.register('IConcertController', { useClass: ConcertController });
    
    container.register('IReserveRepository', { useClass: ReserveRepository });
    container.register('IReserveService',    { useClass: ReserveService });
    container.register('IReserveController', { useClass: ReserveController });

    container.register('ITicketRepository',  { useClass: TicketRepository });
    container.register('IOrderRepository',    { useClass: OrderRepository });
    container.register('ITicketService',     { useClass: TicketService });
    container.register('ITicketController',   { useClass: TicketController });

    container.register('IUserRepository', {useClass : UserRepository});
}
