import { injectable, inject } from 'tsyringe';
import { IConcertRepository } from '../repositories/ConcertRepository';
import type { IEventBus } from './EventBus';
import { NotFoundError } from '../error';
import * as queue from '../queue/queueStore';

// Active-slot cap and pass lifetime, read per call so the values stay configurable (and testable)
// rather than frozen at import. The pass TTL aligns with the 5-minute hold TTL, so an admitted buyer
// holds their slot for exactly one hold window.
const activeLimit = () => Number(process.env.QUEUE_ACTIVE_LIMIT ?? 100);
const passTtlMs = () => Number(process.env.QUEUE_PASS_TTL_MS ?? 5 * 60 * 1000);

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

    /**
     * Push "you're in" to everyone this call promoted, then — since the line just moved — push each
     * remaining waiter their new place. The fan-out is bounded by the queue length; a very large line
     * would want throttling/batching, which is why it only runs when someone was actually promoted.
     */
    private async announce(concertId: string, promoted: string[]): Promise<void> {
        if (promoted.length === 0) return;
        for (const userId of promoted) {
            this.eventBus.publishQueueEvent({ type: 'queue:admitted', concertId, userId });
        }
        await this.broadcastPositions(concertId);
    }

    private async broadcastPositions(concertId: string): Promise<void> {
        const waiting = await queue.listWaiting(concertId);
        waiting.forEach((userId, index) => {
            this.eventBus.publishQueueEvent({ type: 'queue:position', concertId, userId, position: index + 1 });
        });
    }

    async join(concertId: string, userId: string): Promise<QueueResult> {
        if (!(await this.gated(concertId))) return { gated: false, admitted: true, position: 0 };
        const { admitted, position, promoted } = await queue.join(concertId, userId, activeLimit(), passTtlMs());
        await this.announce(concertId, promoted);
        return { gated: true, admitted, position };
    }

    async status(concertId: string, userId: string): Promise<QueueResult> {
        if (!(await this.gated(concertId))) return { gated: false, admitted: true, position: 0 };
        const { admitted, position, promoted } = await queue.status(concertId, userId, activeLimit(), passTtlMs());
        await this.announce(concertId, promoted);
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
        // Whoever was behind them just moved up a place.
        await this.broadcastPositions(concertId);
    }

    async setGating(concertId: string, gatedOnSale: boolean): Promise<void> {
        const affected = await this.concertRepository.setGatedOnSale(concertId, gatedOnSale);
        if (affected === 0) throw new NotFoundError('Concert not found');
    }
}
