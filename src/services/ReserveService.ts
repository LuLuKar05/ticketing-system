import {injectable, inject} from 'tsyringe';
import { Ticket, TicketStatus} from "../entities/Ticket";
import { Reserve, ReserveStatus } from "../entities/Reserve";
import { TicketUnavailableError, UserAlreadyHasTicketError } from "../error";
import type {IReserveRepository} from "../repositories/ReserveRepository";
import type {ITicketRepository } from "../repositories/TicketRepository";


export interface IReserveServiceParams{
    userId: string;
    ticketId: string;
}
export interface IReserveService{
    reserveTickets(params: IReserveServiceParams): Promise<{success: boolean; reserve: Reserve | null}>;
}
@injectable()
export class ReserveService{
    constructor(@inject('IReserveRepository') private reserveRepository: IReserveRepository, @inject('ITicketRepository') private ticketRepository: ITicketRepository){}
    async checkTicketAvailability(ticketId: string): Promise<Ticket>{
        const ticket = await this.ticketRepository.findTicketById(ticketId);
        if (!ticket) {
            throw new TicketUnavailableError('Ticket not found');
        }
        if (ticket.status !== TicketStatus.AVAILABLE) {
            throw new TicketUnavailableError('Ticket is not available');
        }
        return ticket;
    }
    async checkUserExistingTicket(userId: string, concertId: string): Promise<boolean>{
        const existingUserTicket = await this.ticketRepository.findSoldTicketsByUserIdAndConcertId({
            userId,
            concertId
        });
        return existingUserTicket.length > 0;
    }
    //Has to add the validation for the ticketSeat input (string or string[]), and also check the oneTicketPerUser constraint in the concert entity.

    async reserveTickets(params: IReserveServiceParams){
        const {userId,ticketId} = params;
        const ticket = await this.checkTicketAvailability(ticketId);
        if(ticket.concert.oneTicketPerUser){
            const existingUserTicket = await this.checkUserExistingTicket(userId, ticket.concert.id);
            if (existingUserTicket) {
                throw new UserAlreadyHasTicketError();
            }
        }
        //If the ticket is available, reserve it by creating a new Reserve entity and associating it with the ticket and user.
        const reserve = await this.reserveRepository.createReserve({
            userId,
            ticketId,
            status: ReserveStatus.PENDING,
            expiresAt: new Date(Date.now() + 15 * 60 * 1000),// Set expiration time to 15 minutes from now
        });
        return {success: true, reserve};
    }
}



