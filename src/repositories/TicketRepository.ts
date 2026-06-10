import{Repository} from 'typeorm';
import {Ticket, TicketStatus} from '../entities/Ticket';
import {injectable, inject} from 'tsyringe';
/**
 * - TicketRepository is responsible for handling all database operations related to the Ticket entity. 
 *        - findTicketById: Retrieves a ticket by its unique identifier, including its associated concert information.
 *        - findSoldTicketsByUserIdAndConcertId: Retrieves all sold tickets for a specific user and concert.
 *        - findAvailableTicketsByConcertId: Retrieves all available tickets for a specific concert.
 */

export interface IGetAvailableTicketParams{
    concertId: string;
}
export interface IGetSoldTicketsByUserAndConcertParams{
    userId: string;
    concertId: string;
}

export interface ITicketRepository{
    findTicketById(id: string): Promise<Ticket | null>;
    findSoldTicketsByUserIdAndConcertId(params: IGetSoldTicketsByUserAndConcertParams): Promise<Ticket[]>;
    findAvailableTicketsByConcertId(params: IGetAvailableTicketParams): Promise<Ticket[]>;
    findSoldTicketsByConcertId(concertId: string): Promise<Ticket[]>;
    updateTicketStatus(ticketId: string, status: TicketStatus, userId?: string): Promise<void>;
}

@injectable()
export class TicketRepository implements ITicketRepository{
    constructor(@inject('TicketTypeOrmRepo') private repo: Repository<Ticket>){}
    async findTicketById(id: string): Promise<Ticket | null>{
        return this.repo.findOne({
            where: { id },
            relations: {concert: true}
        });
    }
    async findSoldTicketsByUserIdAndConcertId(params: IGetSoldTicketsByUserAndConcertParams): Promise<Ticket[]>{
        return this.repo.createQueryBuilder('ticket')
            .where('ticket.user = :userId', { userId: params.userId })
            .andWhere('ticket.concert = :concertId', { concertId: params.concertId })
            .andWhere('ticket.status = :status', {status: TicketStatus.SOLD})
            .getMany();
    }
    async findAvailableTicketsByConcertId(params: IGetAvailableTicketParams): Promise<Ticket[]>{
        return this.repo.createQueryBuilder('ticket')
            .where('ticket.concert = :concertId', { concertId: params.concertId })
            .andWhere('ticket.status = :status', { status: TicketStatus.AVAILABLE })
            .getMany();
    }
    async findSoldTicketsByConcertId(concertId: string): Promise<Ticket[]>{
        return this.repo.createQueryBuilder('ticket')
            .where('ticket.concert = :concertId', { concertId })
            .andWhere('ticket.status = :status', { status: TicketStatus.SOLD })
            .getMany();
    }
    async updateTicketStatus(ticketId: string, status: TicketStatus, userId?: string): Promise<void>{
        const updateData: Partial<Ticket> = { status, updatedAt: new Date()};
        if (userId) {
            updateData.user = { id: userId } as any; // Assuming User entity has an 'id' field
        }
        await this.repo.update(ticketId, updateData);
    }
}