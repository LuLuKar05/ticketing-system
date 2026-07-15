import { AppDataSource } from './data-source';
import { Concert } from './entities/Concert';
import { Ticket } from './entities/Ticket';
import { Reserve } from './entities/Reserve';
import { TicketTier } from './entities/TicketTier';
import { User } from './entities/User';
import { Order } from './entities/Order';
import { Seat } from './entities/Seat';

import { ConcertController } from './controllers/ConcertController';
import { ReserveController } from './controllers/ReserveController';
import { UserController } from './controllers/UserController';
import { TicketController } from './controllers/TicketController';
import { OrderController } from './controllers/OrderController';
import { ConcertRepository } from './repositories/ConcertRepository';
import { ReserveRepository } from './repositories/ReserveRepository';
import { TicketRepository } from './repositories/TicketRepository';
import { OrderRepository } from './repositories/OrderRepository';
import { SeatRepository } from './repositories/SeatRepository';
import {UserRepository} from './repositories/UserRepository';

import { ConcertService } from './services/ConcertService';
import { ReserveService } from './services/ReserveService';
import { TicketService } from './services/TicketService';
import { SweeperService } from './services/SweeperService';
import { EventBus } from './services/EventBus';
import { SeatService } from './services/SeatService';
import { SeatController } from './controllers/SeatController';

import {container} from 'tsyringe';
import { TicketTierRepository } from './repositories/TicketTierRepository';

export function registerDependencies(){

    container.register('AppDataSource', { useValue: AppDataSource});

    // Singleton so publishers (services) and the socket bridge share one emitter.
    container.registerSingleton('IEventBus', EventBus);

    container.register('ConcertTypeOrmRepo', { useValue: AppDataSource.getRepository(Concert) });
    container.register('ReserveTypeOrmRepo', { useValue: AppDataSource.getRepository(Reserve) });
    container.register('TicketTypeOrmRepo',  { useValue: AppDataSource.getRepository(Ticket) });
    container.register('UserTypeOrmRepo', { useValue: AppDataSource.getRepository(User) });
    container.register('TicketTierTypeOrmRepo', { useValue: AppDataSource.getRepository(TicketTier) });
    container.register('OrderTypeOrmRepo', { useValue: AppDataSource.getRepository(Order) });
    container.register('SeatTypeOrmRepo', { useValue: AppDataSource.getRepository(Seat) });

    container.register('ITicketTierRepository', { useClass: TicketTierRepository });
    container.register('IConcertRepository', { useClass: ConcertRepository });
    container.register('IConcertService',    { useClass: ConcertService });
    container.register('IConcertController', { useClass: ConcertController });
    
    container.register('IReserveRepository', { useClass: ReserveRepository });
    container.register('IReserveService',    { useClass: ReserveService });
    container.register('IReserveController', { useClass: ReserveController });

    container.register('ITicketRepository',  { useClass: TicketRepository });
    container.register('IOrderRepository',    { useClass: OrderRepository });
    container.register('ISeatRepository',     { useClass: SeatRepository });
    container.register('ITicketService',     { useClass: TicketService });
    container.register('ITicketController',   { useClass: TicketController });
    container.register('IOrderController',    { useClass: OrderController });
    container.register('ISeatService',        { useClass: SeatService });
    container.register('ISeatController',      { useClass: SeatController });

    container.register('ISweeperService',     { useClass: SweeperService });

    container.register('IUserRepository', {useClass : UserRepository});
}
