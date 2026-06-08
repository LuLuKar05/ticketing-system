import { AppDataSource } from '../data-source';
import { Concert, ConcertStatus } from '../entities/Concert';
/**
 * concert Service
 * - getConcerts: Fetches a list of concerts based on optional status filter. Defaults to upcoming and ongoing concerts if no status is provided.
 * - getConcertById: Fetches a specific concert by its ID.
 * 
 * Note: Currently, the services are the functions that directly interact with the database.
 * Will refactor the codebase to have more layered architecture( seperate interation of db to repository layer, just call the repo layer)
 * Also had to change to Class based as well.
 */
//Param interface for getConcerts function.
export interface IGetConcertsParams {
    status?: ConcertStatus | 'all';
};
export class ConcertService {
    //constructor(){}
    async getConcerts(params: IGetConcertsParams) : Promise<Concert[]>{
        const concertRepository = AppDataSource.getRepository(Concert);

        const qb = concertRepository.createQueryBuilder('concert');
        qb.select([
            'concert.id',
            'concert.name',
            'concert.concertDate',
            'concert.imageUrl',
            'concert.price',
            'concert.location',
            'concert.artist',
            'concert.genre',
            'concert.totalTickets',
            'concert.availableTickets',
            'concert.ageRestriction',
            'concert.status'
        ]);

        //If status is provided and not 'all', filter by that status. 
        //Otherwise, default to showing only upcoming and ongoing concerts.
        if (params.status && params.status !== 'all') {
            qb.where('concert.status = :status', { status: params.status });
        }else{
            qb.where('concert.status IN (:...statuses)', {
                statuses: [ConcertStatus.UPCOMING, ConcertStatus.ONGOING],
            });
        }
        //For the "PAST" concerts, order by the most recent one(descending).
        //Order by concertDate ascending. 
        const orderByField = params.status === ConcertStatus.PAST ? 'DESC' : 'ASC';
        qb.orderBy('concert.concertDate', orderByField);

        return qb.getMany();
    }

    async getConcertById(id:string): Promise<Concert | null>{
        const concertRepository = AppDataSource.getRepository(Concert);
        return concertRepository.findOneBy({ id });
    }
}