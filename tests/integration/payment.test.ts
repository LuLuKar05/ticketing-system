import { DataSource } from 'typeorm';
import { createTestDataSource } from '../helpers/testDataSource';
import { buildTestContainer } from '../helpers/testContainer';
import { seedBasic } from '../helpers/seed';
import type { IReserveService } from '../../src/services/ReserveService';
import type { ITicketService } from '../../src/services/TicketService';
import type { ChargeResult, IPaymentGateway } from '../../src/payments/PaymentGateway';
import { Ticket, TicketStatus } from '../../src/entities/Ticket';
import { Reserve, ReserveStatus } from '../../src/entities/Reserve';
import { Order, OrderStatus } from '../../src/entities/Order';
import { PaymentFailedError, SeatsUnavailableError, ServiceUnavailableError } from '../../src/error';

/**
 * The payment boundary: money moves at a provider, tickets are rows here, and no transaction spans
 * both. These tests drive the flow against a real database with a scripted gateway, so each crash
 * point is exercised for real rather than reasoned about — including the one that costs money.
 */
describe('Payment (integration)', () => {
    let ds: DataSource;
    let reserveSvc: IReserveService;
    let ticketSvc: ITicketService;
    let gateway: {
        charge: jest.Mock<Promise<ChargeResult>, [Parameters<IPaymentGateway['charge']>[0]]>;
        refund: jest.Mock<Promise<void>, [string]>;
    };

    const approve = (reference = 'ch_test_1'): ChargeResult => ({ success: true, reference });

    const build = () => {
        const c = buildTestContainer(ds, { paymentGateway: gateway });
        reserveSvc = c.resolve<IReserveService>('IReserveService');
        ticketSvc = c.resolve<ITicketService>('ITicketService');
        return c;
    };

    beforeEach(async () => {
        ds = createTestDataSource();
        await ds.initialize();
        gateway = {
            charge: jest.fn().mockResolvedValue(approve()),
            refund: jest.fn().mockResolvedValue(undefined),
        };
        build();
    });
    afterEach(async () => {
        await ds.destroy();
    });

    const hold = (userId: string, concertId: string, seats: string[]) =>
        reserveSvc.reserveTickets({ userId, concertId, seats });

    const orderRow = (id: string) => ds.getRepository(Order).findOneByOrFail({ id });

    it('charges once for the order total and records the reference on the order', async () => {
        const { concertId, userId } = await seedBasic(ds); // seat price 5000
        const { order } = await hold(userId, concertId, ['A1', 'A2']);

        const res = await ticketSvc.confirmOrder({ orderId: order.id, userId });

        expect(gateway.charge).toHaveBeenCalledTimes(1);
        expect(gateway.charge).toHaveBeenCalledWith(
            // The order id IS the idempotency key — that is what makes a retry safe.
            expect.objectContaining({ amount: 2 * 5000, idempotencyKey: order.id }),
        );
        expect(res.tickets).toHaveLength(2);

        const saved = await orderRow(order.id);
        expect(saved.status).toBe(OrderStatus.CONFIRMED);
        expect(saved.totalAmount).toBe(2 * 5000);
        expect(saved.paymentRef).toBe('ch_test_1');
        expect(saved.paidAt).toBeInstanceOf(Date);
    });

    it('never charges twice for a replayed confirm — the second call returns the same tickets', async () => {
        const { concertId, userId } = await seedBasic(ds);
        const { order } = await hold(userId, concertId, ['A1']);

        const first = await ticketSvc.confirmOrder({ orderId: order.id, userId });
        const second = await ticketSvc.confirmOrder({ orderId: order.id, userId });

        expect(gateway.charge).toHaveBeenCalledTimes(1); // the whole point
        expect(second.tickets.map((t) => t.id)).toEqual(first.tickets.map((t) => t.id));
        expect(await ds.getRepository(Ticket).count()).toBe(1);
    });

    describe('when the charge does not succeed', () => {
        it('a decline is a 402, issues nothing, and leaves the order payable again', async () => {
            const { concertId, userId } = await seedBasic(ds);
            const { order } = await hold(userId, concertId, ['A1']);
            gateway.charge.mockResolvedValue({ success: false, declineReason: 'insufficient_funds' });

            await expect(ticketSvc.confirmOrder({ orderId: order.id, userId })).rejects.toBeInstanceOf(
                PaymentFailedError,
            );

            const saved = await orderRow(order.id);
            // Back to PENDING, not FAILED: the hold is still alive, so another card can be tried.
            expect(saved.status).toBe(OrderStatus.PENDING);
            expect(saved.paymentRef).toBeNull();
            expect(await ds.getRepository(Ticket).count()).toBe(0);
            expect(await ds.getRepository(Reserve).countBy({ status: ReserveStatus.PENDING })).toBe(1);
        });

        it('so the buyer can retry with a working card and get their tickets', async () => {
            const { concertId, userId } = await seedBasic(ds);
            const { order } = await hold(userId, concertId, ['A1']);
            gateway.charge.mockResolvedValueOnce({ success: false, declineReason: 'card_declined' });

            await expect(ticketSvc.confirmOrder({ orderId: order.id, userId })).rejects.toBeInstanceOf(
                PaymentFailedError,
            );
            const res = await ticketSvc.confirmOrder({ orderId: order.id, userId });

            expect(res.tickets).toHaveLength(1);
            expect((await orderRow(order.id)).status).toBe(OrderStatus.CONFIRMED);
        });

        it('a provider outage is a 503 (ours, retryable) and charges nothing', async () => {
            const { concertId, userId } = await seedBasic(ds);
            const { order } = await hold(userId, concertId, ['A1']);
            gateway.charge.mockRejectedValue(new Error('ETIMEDOUT'));

            await expect(ticketSvc.confirmOrder({ orderId: order.id, userId })).rejects.toBeInstanceOf(
                ServiceUnavailableError,
            );
            expect((await orderRow(order.id)).status).toBe(OrderStatus.PENDING);
            expect(gateway.refund).not.toHaveBeenCalled(); // nothing to undo
        });
    });

    describe('charged, but the tickets could not be issued', () => {
        // Force the failure the way it really happens: the seat is sold from under this order
        // between the hold and the confirm, so the unique index rejects the INSERT after the
        // money has already moved.
        const sellSeatOutFromUnderThem = async (concertId: string, tierId: string, userId: string, seat: string) => {
            const repo = ds.getRepository(Ticket);
            await repo.save(
                repo.create({
                    seatNumber: seat,
                    status: TicketStatus.SOLD,
                    pricePaid: 5000,
                    concert: { id: concertId },
                    user: { id: userId },
                    ticketTier: { id: tierId },
                }),
            );
        };

        it('refunds the charge and frees the order', async () => {
            const { concertId, tierId, userId } = await seedBasic(ds);
            const { order } = await hold(userId, concertId, ['A1']);
            await sellSeatOutFromUnderThem(concertId, tierId, userId, 'A1');

            await expect(ticketSvc.confirmOrder({ orderId: order.id, userId })).rejects.toBeInstanceOf(
                SeatsUnavailableError,
            );

            expect(gateway.charge).toHaveBeenCalledTimes(1);
            expect(gateway.refund).toHaveBeenCalledWith('ch_test_1'); // compensation ran
            const saved = await orderRow(order.id);
            expect(saved.status).toBe(OrderStatus.PENDING);
            expect(saved.paymentRef).toBeNull();
        });

        it('leaves the order in PAYING when the refund ALSO fails — visible, not silently lost', async () => {
            const { concertId, tierId, userId } = await seedBasic(ds);
            const { order } = await hold(userId, concertId, ['A1']);
            await sellSeatOutFromUnderThem(concertId, tierId, userId, 'A1');
            gateway.refund.mockRejectedValue(new Error('refund endpoint down'));

            await expect(ticketSvc.confirmOrder({ orderId: order.id, userId })).rejects.toBeInstanceOf(
                SeatsUnavailableError,
            );

            // The one state a human has to look at. It is deliberate: we know money moved, we know
            // we could not give it back, and the order says so instead of pretending otherwise.
            expect((await orderRow(order.id)).status).toBe(OrderStatus.PAYING);
        });
    });

    it('rejects a second confirm while a charge is genuinely in flight', async () => {
        const { concertId, userId } = await seedBasic(ds);
        const { order } = await hold(userId, concertId, ['A1']);

        // Hold the gateway open so the order stays in PAYING while the second attempt arrives.
        let releaseCharge: (r: ChargeResult) => void = () => {};
        gateway.charge.mockReturnValueOnce(
            new Promise<ChargeResult>((resolve) => {
                releaseCharge = resolve;
            }),
        );
        const inFlight = ticketSvc.confirmOrder({ orderId: order.id, userId });
        await new Promise((r) => setImmediate(r));

        await expect(ticketSvc.confirmOrder({ orderId: order.id, userId })).rejects.toMatchObject({
            statusCode: 409,
        });

        releaseCharge(approve());
        await expect(inFlight).resolves.toMatchObject({ tickets: expect.any(Array) });
        expect(gateway.charge).toHaveBeenCalledTimes(1);
    });

    it('reclaims an abandoned PAYING order once the claim goes stale (a process died mid-charge)', async () => {
        const { concertId, userId } = await seedBasic(ds);
        const { order } = await hold(userId, concertId, ['A1']);

        // Simulate the crashed attempt: claimed, then nothing. Written as raw SQL because updatedAt
        // is an @UpdateDateColumn — the ORM would helpfully stamp it with "now" and erase the point.
        await ds.query(`UPDATE "order" SET status = $1, "updatedAt" = $2 WHERE id = $3`, [
            OrderStatus.PAYING,
            new Date(Date.now() - 10 * 60_000),
            order.id,
        ]);

        const res = await ticketSvc.confirmOrder({ orderId: order.id, userId });

        // Safe to re-drive precisely because the gateway is keyed on the order id.
        expect(res.tickets).toHaveLength(1);
        expect(res.tickets[0].status).toBe(TicketStatus.SOLD);
        expect((await orderRow(order.id)).status).toBe(OrderStatus.CONFIRMED);
    });
});
