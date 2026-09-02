import { Request, Response, NextFunction } from 'express';
import { IQueueService } from '../services/QueueService';
import { UnauthorizedError, QueueNotAdmittedError } from '../error';

/**
 * Gate a write behind waiting-room admission. MUST run after requireAuth (needs req.user) and after
 * the body is validated (needs req.body.concertId). If the concert isn't gated the queue service
 * lets everyone through; otherwise the caller must hold a live pass.
 */
export function requireActivePass(queueService: IQueueService) {
    return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
        try {
            const userId = req.user?.id;
            if (!userId) return next(new UnauthorizedError());
            const concertId = (req.body as { concertId?: string })?.concertId;
            if (!concertId) return next(); // a missing concertId is the validator's job, not ours
            const admitted = await queueService.isAdmitted(concertId, userId);
            if (!admitted) return next(new QueueNotAdmittedError());
            next();
        } catch (err) {
            next(err);
        }
    };
}
