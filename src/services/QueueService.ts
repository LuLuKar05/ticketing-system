import { injectable, inject } from 'tsyringe';
import { IConcertRepository } from '../repositories/ConcertRepository';
import { NotFoundError } from '../error';
import * as queue from '../queue/queueStore';

// Active-slot cap and pass lifetime. The pass TTL aligns with the 5-minute hold TTL, so an admitted
// buyer holds their slot for exactly one hold window.
const ACTIVE_LIMIT = Number(process.env.QUEUE_ACTIVE_LIMIT ?? 100);
const PASS_TTL_MS = Number(process.env.QUEUE_PASS_TTL_MS ?? 5 * 60 * 1000);

export interface QueueResult {
    gated: boolean;
    admitted: boolean;
    position: number;
}

export interface IQueueService {
    join(concertId: string, userId: string): Promise<QueueResult>;
    status(concertId: string, userId: string): Promise<QueueResult>;
    /** For requireActivePass: true when the concert isn't gated, or the user holds a live pass. */
    isAdmitted(concertId: string, userId: string): Promise<boolean>;
    release(concertId: string, userId: string): Promise<void>;
}

@injectable()
export class QueueService implements IQueueService {
    constructor(@inject('IConcertRepository') private concertRepository: IConcertRepository) {}

    private async gated(concertId: string): Promise<boolean> {
        const concert = await this.concertRepository.findConcertById(concertId);
        if (!concert) throw new NotFoundError('Concert not found');
        return concert.gatedOnSale;
    }

    async join(concertId: string, userId: string): Promise<QueueResult> {
        if (!(await this.gated(concertId))) return { gated: false, admitted: true, position: 0 };
        const state = await queue.join(concertId, userId, ACTIVE_LIMIT, PASS_TTL_MS);
        return { gated: true, ...state };
    }

    async status(concertId: string, userId: string): Promise<QueueResult> {
        if (!(await this.gated(concertId))) return { gated: false, admitted: true, position: 0 };
        const state = await queue.status(concertId, userId, ACTIVE_LIMIT, PASS_TTL_MS);
        return { gated: true, ...state };
    }

    async isAdmitted(concertId: string, userId: string): Promise<boolean> {
        if (!(await this.gated(concertId))) return true; // ungated concert → no queue to pass
        return queue.isAdmitted(concertId, userId);
    }

    async release(concertId: string, userId: string): Promise<void> {
        await queue.release(concertId, userId);
    }
}
