import { Repository, EntityManager } from 'typeorm';
import { Ticket, TicketStatus } from '../entities/Ticket';
import { User } from '../entities/User';
import { injectable, inject } from 'tsyringe';
/**
 * - TicketRepository is responsible for handling all database operations related to the Ticket entity.
 *        - findTicketById: Retrieves a ticket by its unique identifier, including its associated concert information.
 *        - findSoldTicketsByUserIdAndConcertId: Retrieves all sold tickets for a specific user and concert.
 *        - findAvailableTicketsByConcertId: Retrieves all available tickets for a specific concert.
 */

export interface IGetAvailableTicketParams {
    concertId: string;
}
export interface IGetSoldTicketsByUserAndConcertParams {
    userId: string;
    concertId: string;
}
export interface IUpdateTicketParams {
    ticketId: string;
    status: TicketStatus;
    userId?: string;
}
interface ICreateSoldTicketParams {
    concertId: string;
    seatNumber: string;
    userId: string;
    ticketTierId: string;
    pricePaid: number;
    orderId: string;
}
export interface ITicketRepository {
    findTicketById(id: string): Promise<Ticket | null>;
    findSoldTicketsByUserIdAndConcertId(params: IGetSoldTicketsByUserAndConcertParams): Promise<Ticket[]>;
    findSoldTicketsByConcertId(concertId: string): Promise<Ticket[]>;
    updateTicketStatus(params: IUpdateTicketParams): Promise<void>;
    createSoldTicket(params: ICreateSoldTicketParams, manager?: EntityManager): Promise<Ticket>;
    /** All tickets belonging to an order — used to replay an already-confirmed order idempotently. */
    findTicketsByOrderId(orderId: string, manager?: EntityManager): Promise<Ticket[]>;
    /** Of the requested seatNumbers, which are already SOLD for this concert. */
    findSoldSeatNumbers(concertId: string, seatNumbers: string[], manager?: EntityManager): Promise<string[]>;
    /** True if the user already owns a SOLD ticket for this concert (oneTicketPerUser guard). */
    userHasSoldTicketForConcert(userId: string, concertId: string, manager?: EntityManager): Promise<boolean>;
}

@injectable()
export class TicketRepository implements ITicketRepository {
    constructor(@inject('TicketTypeOrmRepo') private repo: Repository<Ticket>) {}
    async findTicketById(id: string): Promise<Ticket | null> {
        return this.repo.findOne({
            where: { id },
            relations: { concert: true },
        });
    }
    async findSoldTicketsByUserIdAndConcertId(params: IGetSoldTicketsByUserAndConcertParams): Promise<Ticket[]> {
        return this.repo
            .createQueryBuilder('ticket')
            .where('ticket.user = :userId', { userId: params.userId })
            .andWhere('ticket.concert = :concertId', { concertId: params.concertId })
            .andWhere('ticket.status = :status', { status: TicketStatus.SOLD })
            .getMany();
    }
    async findSoldTicketsByConcertId(concertId: string): Promise<Ticket[]> {
        return this.repo
            .createQueryBuilder('ticket')
            .where('ticket.concert = :concertId', { concertId })
            .andWhere('ticket.status = :status', { status: TicketStatus.SOLD })
            .getMany();
    }
    async updateTicketStatus(params: IUpdateTicketParams): Promise<void> {
        const { ticketId, status, userId } = params;
        const updateData: Partial<Ticket> = { status, updatedAt: new Date() };
        if (userId) {
            updateData.user = { id: userId } as User; // partial relation — TypeORM only needs the FK id
        }
        await this.repo.update(ticketId, updateData);
    }
    //Create the ticket row in the Ticket Table at the time of purchase confirmation, with status set to SOLD and associated with the user and concert.
    async createSoldTicket(params: ICreateSoldTicketParams, manager?: EntityManager): Promise<Ticket> {
        const { concertId, seatNumber, userId, ticketTierId, pricePaid, orderId } = params;
        const repo = manager ? manager.getRepository(Ticket) : this.repo;
        const ticket = repo.create({
            seatNumber: seatNumber,
            status: TicketStatus.SOLD,
            pricePaid: pricePaid,
            order: { id: orderId },
            concert: { id: concertId },
            user: { id: userId },
            ticketTier: { id: ticketTierId },
        });
        return repo.save(ticket);
    }

    async findTicketsByOrderId(orderId: string, manager?: EntityManager): Promise<Ticket[]> {
        const repo = manager ? manager.getRepository(Ticket) : this.repo;
        return repo.find({ where: { order: { id: orderId } } });
    }

    async findSoldSeatNumbers(concertId: string, seatNumbers: string[], manager?: EntityManager): Promise<string[]> {
        if (seatNumbers.length === 0) return [];
        const repo = manager ? manager.getRepository(Ticket) : this.repo;
        const rows = await repo
            .createQueryBuilder('ticket')
            .select('ticket.seatNumber', 'seatNumber')
            .where('ticket.concert = :concertId', { concertId })
            .andWhere('ticket.seatNumber IN (:...seatNumbers)', { seatNumbers })
            .andWhere('ticket.status = :status', { status: TicketStatus.SOLD })
            .getRawMany<{ seatNumber: string }>();
        return rows.map((r) => r.seatNumber);
    }

    async userHasSoldTicketForConcert(userId: string, concertId: string, manager?: EntityManager): Promise<boolean> {
        const repo = manager ? manager.getRepository(Ticket) : this.repo;
        const count = await repo
            .createQueryBuilder('ticket')
            .where('ticket.user = :userId', { userId })
            .andWhere('ticket.concert = :concertId', { concertId })
            .andWhere('ticket.status = :status', { status: TicketStatus.SOLD })
            .getCount();
        return count > 0;
    }
}
