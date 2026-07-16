import { container as rootContainer, DependencyContainer } from 'tsyringe';
import { DataSource } from 'typeorm';

import { Concert } from '../../src/entities/Concert';
import { Ticket } from '../../src/entities/Ticket';
import { Reserve } from '../../src/entities/Reserve';
import { Order } from '../../src/entities/Order';
import { Seat } from '../../src/entities/Seat';

import { ConcertRepository } from '../../src/repositories/ConcertRepository';
import { ReserveRepository } from '../../src/repositories/ReserveRepository';
import { TicketRepository } from '../../src/repositories/TicketRepository';
import { OrderRepository } from '../../src/repositories/OrderRepository';
import { SeatRepository } from '../../src/repositories/SeatRepository';

import { ConcertService } from '../../src/services/ConcertService';
import { ReserveService } from '../../src/services/ReserveService';
import { TicketService } from '../../src/services/TicketService';
import { SweeperService } from '../../src/services/SweeperService';
import { EventBus } from '../../src/services/EventBus';

import { ConcertController } from '../../src/controllers/ConcertController';
import { ReserveController } from '../../src/controllers/ReserveController';
import { OrderController } from '../../src/controllers/OrderController';
import { SeatController } from '../../src/controllers/SeatController';
import { SeatService } from '../../src/services/SeatService';

/**
 * Build a tsyringe child container wired to a TEST DataSource (mirrors src/container.ts).
 * A child container keeps registrations isolated per test file.
 */
export function buildTestContainer(ds: DataSource): DependencyContainer {
    const c = rootContainer.createChildContainer();

    c.register('AppDataSource', { useValue: ds });
    c.registerSingleton('IEventBus', EventBus);

    c.register('ConcertTypeOrmRepo', { useValue: ds.getRepository(Concert) });
    c.register('ReserveTypeOrmRepo', { useValue: ds.getRepository(Reserve) });
    c.register('TicketTypeOrmRepo', { useValue: ds.getRepository(Ticket) });
    c.register('OrderTypeOrmRepo', { useValue: ds.getRepository(Order) });
    c.register('SeatTypeOrmRepo', { useValue: ds.getRepository(Seat) });

    c.register('IConcertRepository', { useClass: ConcertRepository });
    c.register('IReserveRepository', { useClass: ReserveRepository });
    c.register('ITicketRepository', { useClass: TicketRepository });
    c.register('IOrderRepository', { useClass: OrderRepository });
    c.register('ISeatRepository', { useClass: SeatRepository });

    c.register('IConcertService', { useClass: ConcertService });
    c.register('IReserveService', { useClass: ReserveService });
    c.register('ITicketService', { useClass: TicketService });
    c.register('ISweeperService', { useClass: SweeperService });

    c.register('IConcertController', { useClass: ConcertController });
    c.register('IReserveController', { useClass: ReserveController });
    c.register('IOrderController', { useClass: OrderController });
    c.register('ISeatService', { useClass: SeatService });
    c.register('ISeatController', { useClass: SeatController });

    return c;
}
