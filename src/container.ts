import { AppDataSource } from './data-source';
import { Concert } from './entities/Concert';
import { Ticket } from './entities/Ticket';
import {Reserve} from './entities/Reserve';

import { ConcertController } from './controllers/ConcertController';
import { ReserveController } from './controllers/ReserveController';
import { ConcertRepository } from './repositories/ConcertRepository';
import { ReserveRepository } from './repositories/ReserveRepository';
import { TicketRepository } from './repositories/TicketRepository';
import { ConcertService } from './services/ConcertService';
import { ReserveService } from './services/ReserveService';

import {container} from 'tsyringe';
export function registerDependencies(){
    container.register('ConcertTypeOrmRepo', { useValue: AppDataSource.getRepository(Concert) });
    container.register('ReserveTypeOrmRepo', { useValue: AppDataSource.getRepository(Reserve) });
    container.register('TicketTypeOrmRepo', { useValue: AppDataSource.getRepository(Ticket) });

    container.register('IConcertRepository', { useClass: ConcertRepository });
    container.register('IConcertService', { useClass: ConcertService });
    container.register('IConcertController', { useClass: ConcertController });
    container.register('IReserveRepository', { useClass: ReserveRepository });
    container.register('IReserveService', { useClass: ReserveService });
    container.register('IReserveController', { useClass: ReserveController });

    container.register('ITicketRepository', { useClass: TicketRepository });
    //container.register('ITicketService', { useClass: TicketService });
}
