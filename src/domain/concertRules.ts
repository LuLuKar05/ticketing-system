import { Concert, ConcertStatus } from '../entities/Concert';
import { ConcertNotSellableError } from '../error';

/**
 * Pure domain rule: which concerts may accept new holds/sales.
 *
 * Allowlist (fail-closed): a concert is sellable ONLY if its status is one of SELLABLE_STATUSES
 * AND its date is still in the future. Any other/unknown status is rejected — safer for a
 * money-handling path, since a status added later defaults to NOT sellable until this list opts it in.
 *
 * Used by BOTH the hold path (ReserveService) and the pay path (TicketService) so a concert that is
 * cancelled — or simply reaches its date — while an order is pending can no longer be paid for.
 */
export const SELLABLE_STATUSES: ReadonlySet<ConcertStatus> = new Set([
    ConcertStatus.UPCOMING,
    ConcertStatus.RESCHEDULED,
]);

export function assertConcertSellable(concert: Concert): void {
    if (!SELLABLE_STATUSES.has(concert.status)) {
        throw new ConcertNotSellableError(`This concert is not open for sales (status: ${concert.status})`);
    }
    if (concert.concertDate <= new Date()) {
        throw new ConcertNotSellableError('This concert has already started or passed');
    }
}
