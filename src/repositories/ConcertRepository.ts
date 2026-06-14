import { Repository } from "typeorm";
import { Concert, ConcertStatus } from "../entities/Concert";
import { inject, injectable} from "tsyringe";
export interface IGetConcertsParams {
    status?: ConcertStatus | 'all';
}
export interface IConcertRepository{
    findConcertById(id: string): Promise<Concert | null>;
    findConcertsByParams(params: IGetConcertsParams): Promise<Concert[]>;

    updateConcertStatus(params: {id: string, status: ConcertStatus}): Promise<void>;
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
    async updateConcertStatus(params: {id: string, status: ConcertStatus}): Promise<void>{
        await this.repo.update(params.id, { status: params.status });
    }
}