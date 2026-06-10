import { Concert } from '../entities/Concert';
import {IGetConcertsParams, IConcertRepository} from '../repositories/ConcertRepository';
import {injectable, inject} from 'tsyringe';
/**
 * concert Service
 * - getConcerts: Fetches a list of concerts based on optional status filter. Defaults to upcoming and ongoing concerts if no status is provided.
 * - getConcertById: Fetches a specific concert by its ID.
 */

export interface IConcertService{
    getConcerts(params: IGetConcertsParams): Promise<Concert[]>;
    getConcertById(id: string): Promise<Concert | null>;
}
@injectable()
export class ConcertService {
    constructor(
        @inject('IConcertRepository') private concertRepository: IConcertRepository
    ){}
    async getConcerts(params: IGetConcertsParams) : Promise<Concert[]>{
        return this.concertRepository.findConcertsByParams(params);
    }
    async getConcertById(id:string): Promise<Concert | null>{
        return this.concertRepository.findConcertById(id);
    }
}