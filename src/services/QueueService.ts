import { injectable, inject } from 'tsyringe';
import { IConcertRepository } from '../repositories/ConcertRepository';
import type { IEventBus } from './EventBus';
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
    /** User-initiated exit — drop out of the line or give up an admitted slot. */
    leave(concertId: string, userId: string): Promise<void>;
    /** Admin: turn the waiting room on/off for a concert. */
    setGating(concertId: string, gatedOnSale: boolean): Promise<void>;
}

@injectable()
export class QueueService implements IQueueService {
    constructor(
        @inject('IConcertRepository') private concertRepository: IConcertRepository,
        @inject('IEventBus') private eventBus: IEventBus,
    ) {}

    private async gated(concertId: string): Promise<boolean> {
        const concert = await this.concertRepository.findConcertById(concertId);
        if (!concert) throw new NotFoundError('Concert not found');
        return concert.gatedOnSale;
    }

    // Push a "you're in" event to every user this call promoted (real-time admission).
    private announce(concertId: string, promoted: string[]): void {
        for (const userId of promoted) {
            this.eventBus.publishQueueEvent({ type: 'queue:admitted', concertId, userId });
        }
    }

    async join(concertId: string, userId: string): Promise<QueueResult> {
        if (!(await this.gated(concertId))) return { gated: false, admitted: true, position: 0 };
        const { admitted, position, promoted } = await queue.join(concertId, userId, ACTIVE_LIMIT, PASS_TTL_MS);
        this.announce(concertId, promoted);
        return { gated: true, admitted, position };
    }

    async status(concertId: string, userId: string): Promise<QueueResult> {
        if (!(await this.gated(concertId))) return { gated: false, admitted: true, position: 0 };
        const { admitted, position, promoted } = await queue.status(concertId, userId, ACTIVE_LIMIT, PASS_TTL_MS);
        this.announce(concertId, promoted);
        return { gated: true, admitted, position };
    }

    async isAdmitted(concertId: string, userId: string): Promise<boolean> {
        if (!(await this.gated(concertId))) return true; // ungated concert → no queue to pass
        return queue.isAdmitted(concertId, userId);
    }

    async release(concertId: string, userId: string): Promise<void> {
        await queue.release(concertId, userId);
    }

    async leave(concertId: string, userId: string): Promise<void> {
        await queue.leave(concertId, userId);
    }

    async setGating(concertId: string, gatedOnSale: boolean): Promise<void> {
        const affected = await this.concertRepository.setGatedOnSale(concertId, gatedOnSale);
        if (affected === 0) throw new NotFoundError('Concert not found');
    }
}
