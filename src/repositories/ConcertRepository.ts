import { Repository } from "typeorm";
import { Concert, ConcertStatus } from "../entities/Concert";
import { inject, injectable} from "tsyringe";
export interface IGetConcertsParams {
    status?: ConcertStatus | 'all';
}
export interface IConcertRepository{
    findConcertById(id: string): Promise<Concert | null>;
    findConcertsByParams(params: IGetConcertsParams): Promise<Concert[]>;
}

@injectable()
export class ConcertRepository implements IConcertRepository{
    constructor(@inject('ConcertTypeOrmRepo')  private repo: Repository<Concert>){}
    async findConcertById(id: string): Promise<Concert | null>{
        return await this.repo.findOneBy({ id });
    }
    async findConcertsByParams(params: IGetConcertsParams): Promise<Concert[]>{
        const qb = this.repo.createQueryBuilder('concert')
            .select([
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
            if(params.status && params.status !== 'all'){
                qb.where('concert.status = :status', { status: params.status });
            }else{
                qb.where('concert.status IN (:...statuses)', {
                    statuses: [ConcertStatus.UPCOMING, ConcertStatus.ONGOING],
                });
            }
            qb.orderBy('concert.concertDate', params.status === ConcertStatus.PAST ? 'DESC' : 'ASC');
        return qb.getMany();
    }
}