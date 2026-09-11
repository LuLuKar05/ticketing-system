import { randomUUID } from 'crypto';
import { injectable } from 'tsyringe';
import { logger } from '../observability/logger';
import type { ChargeRequest, ChargeResult, IPaymentGateway } from './PaymentGateway';

/**
 * A stand-in gateway for development. It is not a stub that always says yes — it models the two
 * provider behaviours the confirm flow actually depends on:
 *
 *  1. **Idempotency.** Charges are remembered by `idempotencyKey`, so re-charging the same order
 *     returns the ORIGINAL reference and takes no second payment. This is what makes the retry path
 *     testable rather than merely asserted.
 *  2. **Declines.** A card can be refused, and the flow has to unwind cleanly.
 *
 * The decline trigger is the amount: any total whose last two digits are `13` (e.g. 1013 = $10.13)
 * is refused. That mirrors the magic test values real providers ship (Stripe's 4000…0002 card) and
 * makes a 402 reachable by hand with curl, not only from an injected fake.
 *
 * State is per-process and in memory: this exists to develop against, never to take money.
 */
const DECLINE_WHEN_AMOUNT_ENDS_IN = 13;

@injectable()
export class MockPaymentGateway implements IPaymentGateway {
    private readonly charges = new Map<string, ChargeResult>();
    private readonly refunded = new Set<string>();

    charge(request: ChargeRequest): Promise<ChargeResult> {
        const previous = this.charges.get(request.idempotencyKey);
        if (previous) {
            // Same key = same intent. Return the original outcome; do not charge again.
            logger.info({ idempotencyKey: request.idempotencyKey }, 'payment: idempotent replay, no second charge');
            return Promise.resolve(previous);
        }

        const result: ChargeResult =
            request.amount % 100 === DECLINE_WHEN_AMOUNT_ENDS_IN
                ? { success: false, declineReason: 'card_declined' }
                : { success: true, reference: `mock_ch_${randomUUID()}` };

        this.charges.set(request.idempotencyKey, result);
        logger.info(
            { idempotencyKey: request.idempotencyKey, amount: request.amount, success: result.success },
            'payment: charge processed (mock gateway)',
        );
        return Promise.resolve(result);
    }

    refund(reference: string): Promise<void> {
        // Idempotent by contract — compensation may be retried.
        this.refunded.add(reference);
        logger.warn({ reference }, 'payment: refunded (mock gateway)');
        return Promise.resolve();
    }
}
