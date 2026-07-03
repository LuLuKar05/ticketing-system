import {injectable, inject} from 'tsyringe';
import  { Ticket, TicketStatus } from "../entities/Ticket";
import {Reserve, ReserveStatus} from "../entities/Reserve"
import { ITicketRepository } from "../repositories/TicketRepository";
import { DataSource } from 'typeorm';
import { IReserveRepository } from '../repositories/ReserveRepository';
import { TicketUnavailableError } from '../error';
import { TicketTier } from '../entities/TicketTier';


export interface IconfirmPurchaseParams {
    userId: string;
    ticketId: string;
    reserveId: string;
    ticketTierId: string;
    ticketTierQuantity?: number;
}
interface IconfirmRefundParams{
    userId: string;
    ticketId: string;
    ticketTierId: string;
    ticketStatus?: TicketStatus;
}
interface ICreateTicketForConcertParams{
    concertId: string;
    seatNumber: number | String[];
}
export interface ITicketService{
    sellTicketsByConcertId(ticketId: string, userId: string): Promise<void>;
    confirmPurchase(params: IconfirmPurchaseParams): Promise<Ticket | null>;
    refundTicket(params: IconfirmRefundParams): Promise<void>;
    cancelAllTicketsByConcertId(params: { concertId: string }): Promise<void>;
    createTicketForConcert(params: ICreateTicketForConcertParams): Promise<Ticket>;
}
@injectable()
export class TicketService implements ITicketService {
constructor(
    @inject('AppDataSource') private dataSource: DataSource,
    @inject('ITicketRepository') private ticketRepository: ITicketRepository,
    @inject('IReserveRepository') private reserveRepository: IReserveRepository
    ){}
    async sellTicketsByConcertId( ticketId: string, userId: string): Promise<void>{
        return this.ticketRepository.updateTicketStatus({ ticketId, status: TicketStatus.SOLD, userId });
    }

    async confirmPurchase(params: IconfirmPurchaseParams): Promise<Ticket>{
        const { userId, ticketId, reserveId, ticketTierId } = params;
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();
        try {
            //Pessimistic Locking to ticket and reservation rows to prevent concurrent updates and ensure data integrity during the purchase confirmation process.
            const ticket = await queryRunner.manager.findOne(Ticket, {
                where: { id: ticketId , status: TicketStatus.AVAILABLE},
                relations: { concert: true },
                lock: { mode: 'pessimistic_write' } 
            });
            const reservation = await queryRunner.manager.findOne(Reserve, {
                where: { id: reserveId, status: ReserveStatus.PENDING },
                lock: { mode: 'pessimistic_write' } 
            });
            const ticketTierQuantity = await queryRunner.manager.findOne(TicketTier, {
                where: { id: ticketTierId, },
                lock: { mode: 'pessimistic_write' }
            });
            //Validation
            if(!ticket) throw new TicketUnavailableError('Ticket isn\'t available anymore');
            if(!reservation) throw new TicketUnavailableError('Reservation isn\'t valid anymore');

            ticket.status = TicketStatus.SOLD;
            ticket.user = {id: userId} as any; 
            reservation.status = ReserveStatus.CONFIRMED;

            await queryRunner.manager.save(ticket);
            await queryRunner.manager.save(reservation);

            await queryRunner.commitTransaction();
            return ticket;
        } catch (error) {
            await queryRunner.rollbackTransaction();
            throw error;
        } finally {
            await queryRunner.release(); //release the connection
        }
    }
    /**
     * 
     */
    async refundTicket(params: IconfirmRefundParams): Promise<void>{
        const { userId, ticketId, ticketStatus } = params;
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();
        try {
            const ticket = await queryRunner.manager.findOne(Ticket, {
                where: { id: ticketId , status: TicketStatus.SOLD, user: {id: userId} },
                relations: { concert: true },
                lock: { mode: 'pessimistic_write' } 
            });
            if(!ticket) throw new TicketUnavailableError('Ticket isn\'t eligible for refund');
            ticket.status = ticketStatus || TicketStatus.REFUNDED;
            ticket.user = null;
            await queryRunner.manager.save(ticket);
            await queryRunner.commitTransaction();
        }catch(error){
            await queryRunner.rollbackTransaction();
            throw error;
        } finally {
            await queryRunner.release();
        }

    }
    async cancelAllTicketsByConcertId(params: { concertId: string }): Promise<void>{
        await this.dataSource.createQueryBuilder()
                                .update(Ticket)
                                .set({ status: TicketStatus.CANCELLED, updatedAt: new Date() })
                                .where('concertId = :concertId', { concertId: params.concertId })
                                .execute();
    }
    async createTicketForConcert(params: ICreateTicketForConcertParams): Promise<Ticket>{

        return {} as Ticket;
    }
}