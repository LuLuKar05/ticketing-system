import { MockPaymentGateway } from '../../src/payments/MockPaymentGateway';

/**
 * The mock isn't scaffolding — the confirm flow's safety rests on two provider behaviours, and this
 * pins both so the flow is exercised against something that actually behaves like a gateway.
 */
describe('MockPaymentGateway', () => {
    let gateway: MockPaymentGateway;

    beforeEach(() => {
        gateway = new MockPaymentGateway();
    });

    const charge = (amount: number, key = 'order-1') =>
        gateway.charge({ amount, currency: 'usd', idempotencyKey: key });

    it('approves an ordinary charge and returns a reference', async () => {
        const result = await charge(5000);
        expect(result.success).toBe(true);
        expect(result.success && result.reference).toMatch(/^mock_ch_/);
    });

    it('returns the SAME reference for a repeated idempotency key — one intent, one charge', async () => {
        const first = await charge(5000, 'order-42');
        const second = await charge(5000, 'order-42');
        expect(second).toEqual(first);
    });

    it('treats a different order as a different charge', async () => {
        const a = await charge(5000, 'order-a');
        const b = await charge(5000, 'order-b');
        expect(a.success && b.success && a.reference).not.toBe(b.success && b.reference);
    });

    it('declines an amount ending in 13, so a 402 is reachable without a stub', async () => {
        const result = await charge(1013);
        expect(result.success).toBe(false);
        expect(!result.success && result.declineReason).toBe('card_declined');
    });

    it('replays a DECLINE under the same key too — a retry must not turn a no into a yes', async () => {
        const first = await charge(1013, 'order-declined');
        const second = await charge(1013, 'order-declined');
        expect(second).toEqual(first);
        expect(second.success).toBe(false);
    });

    it('refunds without complaint, and tolerates being called twice (compensation may retry)', async () => {
        const result = await charge(5000);
        const reference = result.success ? result.reference : '';
        await expect(gateway.refund(reference)).resolves.toBeUndefined();
        await expect(gateway.refund(reference)).resolves.toBeUndefined();
    });
});
