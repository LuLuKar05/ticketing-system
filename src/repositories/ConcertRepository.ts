import { Repository } from 'typeorm';
import { Concert, ConcertStatus } from '../entities/Concert';
import { inject, injectable } from 'tsyringe';
export interface IGetConcertsParams {
    status?: ConcertStatus | 'all';
}
export interface IConcertRepository {
    findConcertById(id: string): Promise<Concert | null>;
    /** Detail view: the concert with its ticket tiers (name/price/quantity) loaded. */
    findConcertByIdWithTiers(id: string): Promise<Concert | null>;
    findConcertsByParams(params: IGetConcertsParams): Promise<Concert[]>;

    updateConcertStatus(params: { id: string; status: ConcertStatus }): Promise<void>;
    /** Toggle the waiting-room gate on a concert. Returns rows affected (0 = concert not found). */
    setGatedOnSale(id: string, gatedOnSale: boolean): Promise<number>;
}

@injectable()
export class ConcertRepository implements IConcertRepository {
    constructor(@inject('ConcertTypeOrmRepo') private repo: Repository<Concert>) {}
    // Lean — used by the hold path (ReserveService) which only needs the concert's own columns.
    async findConcertById(id: string): Promise<Concert | null> {
        return await this.repo.findOneBy({ id });
    }
    // Detail view — eager-loads the tiers so the client can show/choose them.
    async findConcertByIdWithTiers(id: string): Promise<Concert | null> {
        return this.repo.findOne({ where: { id }, relations: { ticketTiers: true } });
    }
    async findConcertsByParams(params: IGetConcertsParams): Promise<Concert[]> {
        const qb = this.repo
            .createQueryBuilder('concert')
            .select([
                'concert.id',
                'concert.name',
                'concert.concertDate',
                'concert.imageUrl',
                'concert.location',
                'concert.artist',
                'concert.genre',
                'concert.totalTickets',
                'concert.ageRestriction',
                'concert.status',
            ]);
        if (params.status && params.status !== 'all') {
            // a specific status
            qb.where('concert.status = :status', { status: params.status });
        } else if (!params.status) {
            // default view → only upcoming + ongoing
            qb.where('concert.status IN (:...statuses)', {
                statuses: [ConcertStatus.UPCOMING, ConcertStatus.ONGOING],
            });
        }
        // else: params.status === 'all' → no status filter (every status)
        qb.orderBy('concert.concertDate', params.status === ConcertStatus.PAST ? 'DESC' : 'ASC');
        return qb.getMany();
    }
    async updateConcertStatus(params: { id: string; status: ConcertStatus }): Promise<void> {
        await this.repo.update(params.id, { status: params.status });
    }
    async setGatedOnSale(id: string, gatedOnSale: boolean): Promise<number> {
        const result = await this.repo.update(id, { gatedOnSale });
        return result.affected ?? 0;
    }
}
