import type { Ticket } from "../entities/Ticket";

export interface ITicketService{
    sellTicketsByConcertId(concertId: string): Promise<Ticket[]>;
}
export class TicketService implements ITicketService {
    async sellTicketsByConcertId(concertId: string): Promise<Ticket[]>{
        // This method will fetch all sold tickets for a specific concert. It will be used in the ConcertController to provide information about ticket sales for each concert.
        // The implementation will involve querying the TicketRepository to retrieve tickets with a status of SOLD for the given concert ID.
        
        return [];
    }

}