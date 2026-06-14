import {Repository} from 'typeorm';
import {Reserve, ReserveStatus} from '../entities/Reserve';
import {inject, injectable} from 'tsyringe';

export interface ICreateReserveParams{
    userId: string;
    ticketId: string;
    status: ReserveStatus;
    expiresAt: Date;
}
export interface IUpdateReserveStatusParams{
    id: string;
    status: ReserveStatus;
}
export interface IDeleteReserveParams{
    id: string;
}

export interface IReserveRepository{
    findReserveById(id: string): Promise<Reserve | null>;
    createReserve(reserveData: ICreateReserveParams): Promise<Reserve>;
    updateReserveStatus(params: IUpdateReserveStatusParams): Promise<void>;
    deleteReserve(deleteData: IDeleteReserveParams): Promise<void>;
}

@injectable()
export class ReserveRepository implements IReserveRepository{
    constructor(@inject('ReserveTypeOrmRepo') private repo: Repository<Reserve>){}
    async findReserveById(id: string): Promise<Reserve | null>{
        return this.repo.findOneBy({ id });
    }

    async createReserve(reserveData: ICreateReserveParams): Promise<Reserve>{
            const reserve = this.repo.create({
                user: {id: reserveData.userId},
                ticket: {id: reserveData.ticketId},
                status: reserveData.status,
                expiresAt: reserveData.expiresAt,
            });
            return await this.repo.save(reserve);
    }

    async updateReserveStatus(params: IUpdateReserveStatusParams): Promise<void>{
        await this.repo.update(params.id, { status: params.status });
    }

    async deleteReserve(deleteData: IDeleteReserveParams): Promise<void>{
        await this.repo.delete(deleteData.id);
    }   
}