import {AppDataSource} from "../data-source";
import { Ticket, TicketStatus} from "../entities/Ticket";
import { Reserve, ReserveStatus } from "../entities/Reserve";
import { TicketUnavailableError, UserAlreadyHasTicketError } from "../error";

export interface IReserveTicketsParams{
    userId: string;
    ticketID: string;
}
export class ReserveService{
    constructor(){}
    async checkTicketAvailability(ticketID: string): Promise<Ticket | null>{
        const ticketRepository = AppDataSource.getRepository(Ticket);
        const ticket: Ticket | null = await ticketRepository.findOne({
            where: { id: ticketID, status: TicketStatus.AVAILABLE },
            relations: { concert: true},
        });
        return ticket;
    }
    async checkUserExistingTicket(userId: string, concertId: string): Promise<boolean>{
        const ticketRepository = AppDataSource.getRepository(Ticket);
        const existingUserTicket = await ticketRepository.findOne({
            where: {
                user: {id: userId},
                concert: { id: concertId },
                status: TicketStatus.SOLD
            },
        });
        return !!existingUserTicket;
    }
    //Has to add the validation for the ticketSeat input (string or string[]), and also check the oneTicketPerUser constraint in the concert entity.

    async reserveTickets(params: IReserveTicketsParams){
        const {userId,ticketID} = params;
        const ticket = await this.checkTicketAvailability(ticketID);
        if(!ticket) throw new TicketUnavailableError();
        if(ticket.concert.oneTicketPerUser){
            const existingUserTicket = await this.checkUserExistingTicket(userId, ticket.concert.id);
            if (existingUserTicket) {
                throw new UserAlreadyHasTicketError();
            }
        }
        //If the ticket is available, reserve it by creating a new Reserve entity and associating it with the ticket and user.
        const reserveRepository = AppDataSource.getRepository(Reserve);
        const reserve = reserveRepository.create({
            user: {id: userId},
            ticket: {id: ticketID},
            status: ReserveStatus.PENDING,
            expiresAt: new Date(Date.now() + 15 * 60 * 1000),// Set expiration time to 15 minutes from now
        });
        await reserveRepository.save(reserve);
        return {success: true, reserve};
    }
}



