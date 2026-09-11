/**
 * The seam between the domain and whatever actually moves money.
 *
 * Everything the ticketing flow needs is here: charge once, and be able to give it back. Keeping it
 * this small is deliberate — `TicketService` must not know whether the other side is a mock, Stripe,
 * or Adyen, and swapping one for another must not touch a single line of the confirm flow.
 */
export interface ChargeRequest {
    /** Minor units (cents), matching how prices are stored throughout the domain. */
    amount: number;
    currency: string;
    /**
     * The key that makes a retry safe. We pass the **orderId**: one order is one payment intent, so
     * a client retry, a double-click, or our own re-drive after a network timeout all resolve to the
     * same charge at the provider instead of a second one. Every real gateway supports this; the
     * mock implements it too, precisely so the guarantee is exercised in tests.
     */
    idempotencyKey: string;
    /** Provider-specific payment instrument (a card token, etc.). Unused by the mock. */
    source?: string;
}

export type ChargeResult = { success: true; reference: string } | { success: false; declineReason: string };

export interface IPaymentGateway {
    charge(request: ChargeRequest): Promise<ChargeResult>;
    /**
     * Compensation. There is no transaction spanning the gateway and the database, so when the
     * charge succeeds and the ticket write then fails, this is the only way back to a consistent
     * state. It must be safe to call more than once for the same reference.
     */
    refund(reference: string): Promise<void>;
}
