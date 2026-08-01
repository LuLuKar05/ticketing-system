import { Concert, ConcertStatus } from '../entities/Concert';
import { IGetConcertsParams, IConcertRepository } from '../repositories/ConcertRepository';
import { injectable, inject } from 'tsyringe';
import { ITicketService } from './TicketService';
import { NotFoundError } from '../error';
/**
 * concert Service
 * - getConcerts: Fetches a list of concerts based on optional status filter. Defaults to upcoming and ongoing concerts if no status is provided.
 * - getConcertById: Fetches a specific concert by its ID.
 */

export interface IConcertService {
    getConcerts(params: IGetConcertsParams): Promise<Concert[]>;
    getConcertById(id: string): Promise<Concert>;
    cancelConcertById(id: string): Promise<void>;
}
@injectable()
export class ConcertService implements IConcertService {
    constructor(
        @inject('IConcertRepository') private concertRepository: IConcertRepository,
        @inject('ITicketService') private ticketService: ITicketService,
    ) {}
    async getConcerts(params: IGetConcertsParams): Promise<Concert[]> {
        return this.concertRepository.findConcertsByParams(params);
    }
    async getConcertById(id: string): Promise<Concert> {
        const concert = await this.concertRepository.findConcertByIdWithTiers(id);
        if (!concert) throw new NotFoundError('Concert not found');
        return concert;
    }
    async cancelConcertById(id: string): Promise<void> {
        await this.concertRepository.updateConcertStatus({ id, status: ConcertStatus.CANCELLED });
        await this.ticketService.cancelAllTicketsByConcertId({ concertId: id });

        //Update all the reserve for this concert will be changed to cancelled as well.
        //Block all the incoming reservation for this concert as well, so we need to add a check in the reservation creation process to prevent creating reservation for a cancelled concert.

        //Additional cancellation logic can be added here,
        //such as sending notifications to users who purchased tickets for the concert, processing refunds for sold tickets,
        // and updating any related entities or records in the system to reflect the cancellation of the concert.
    }
}
