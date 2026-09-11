import { QueryFailedError } from 'typeorm';
import { TicketService } from '../../src/services/TicketService';
import { ConcertStatus } from '../../src/entities/Concert';

const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

function makeReserve(over: Record<string, unknown> = {}) {
    return {
        id: 'r1',
        status: 'pending',
        expiresAt: new Date(Date.now() + 60_000),
        seatNumber: 'A1',
        concert: { id: 'c1', oneTicketPerUser: false, status: ConcertStatus.UPCOMING, concertDate: FUTURE },
        ticketTier: { id: 't1', price: 5000 },
        ...over,
    };
}
function makeOrder(over: Record<string, unknown> = {}) {
    return { id: 'o1', status: 'pending', user: { id: 'u1' }, reserves: [makeReserve()], ...over };
}

describe('TicketService.confirmOrder (unit, mocked dependencies)', () => {
    let manager: any;
    let qr: any;
    let dataSource: any;
    let reserveRepo: any;
    let ticketRepo: any;
    let orderRepo: any;
    let eventBus: any;
    let queueService: any;
    let gateway: any;
    let service: TicketService;

    beforeEach(() => {
        manager = { findOne: jest.fn(), save: jest.fn(), update: jest.fn() };
        qr = {
            connect: jest.fn(),
            startTransaction: jest.fn(),
            commitTransaction: jest.fn(),
            rollbackTransaction: jest.fn(),
            release: jest.fn(),
            manager,
        };
        // Validation reads happen OUTSIDE the transaction now (the gateway call must not run with
        // one open), so the DataSource needs its own manager. Same mock, so the tests still drive
        // the reads through manager.findOne.
        dataSource = { createQueryRunner: jest.fn(() => qr), manager };
        reserveRepo = { updateReserveStatus: jest.fn() };
        ticketRepo = {
            userHasSoldTicketForConcert: jest.fn().mockResolvedValue(false),
            createSoldTicket: jest
                .fn()
                .mockImplementation((p: any) => Promise.resolve({ seatNumber: p.seatNumber, pricePaid: p.pricePaid })),
            findTicketsByOrderId: jest.fn().mockResolvedValue([]),
        };
        // Compare-and-set claim wins by default (1 row affected), and settling succeeds.
        orderRepo = {
            claimOrderForPayment: jest.fn().mockResolvedValue(1),
            releasePaymentClaim: jest.fn().mockResolvedValue(1),
            markOrderPaid: jest.fn().mockResolvedValue(1),
        };
        eventBus = { publishSeatEvent: jest.fn() };
        queueService = { release: jest.fn().mockResolvedValue(undefined) };
        gateway = {
            charge: jest.fn().mockResolvedValue({ success: true, reference: 'ch_1' }),
            refund: jest.fn().mockResolvedValue(undefined),
        };
        service = new TicketService(dataSource, reserveRepo, ticketRepo, orderRepo, eventBus, queueService, gateway);
    });

    const confirm = () => service.confirmOrder({ orderId: 'o1', userId: 'u1' });

    it('happy path: creates tickets, confirms reserves, commits, publishes seat:sold', async () => {
        manager.findOne.mockResolvedValue(makeOrder());
        const res = await confirm();
        expect(res.tickets).toHaveLength(1);
        expect(res.order.status).toBe('confirmed');
        expect(res.order.totalAmount).toBe(5000);
        expect(reserveRepo.updateReserveStatus).toHaveBeenCalledWith({ id: 'r1', status: 'confirmed' }, manager);
        // Charged once, keyed on the order, and settled with the provider's reference.
        expect(gateway.charge).toHaveBeenCalledWith(expect.objectContaining({ amount: 5000, idempotencyKey: 'o1' }));
        expect(orderRepo.markOrderPaid).toHaveBeenCalledWith(
            expect.objectContaining({ orderId: 'o1', totalAmount: 5000, paymentRef: 'ch_1' }),
            manager,
        );
        expect(res.order.paymentRef).toBe('ch_1');
        expect(qr.commitTransaction).toHaveBeenCalledTimes(1);
        expect(qr.release).toHaveBeenCalledTimes(1);
        expect(eventBus.publishSeatEvent).toHaveBeenCalledWith({
            type: 'seat:sold',
            concertId: 'c1',
            seatNumbers: ['A1'],
        });
        // purchase complete → the buyer's waiting-room slot is freed for the next person
        expect(queueService.release).toHaveBeenCalledWith('c1', 'u1');
    });

    it('order not found → NotFoundError', async () => {
        manager.findOne.mockResolvedValue(null);
        await expect(confirm()).rejects.toMatchObject({ name: 'NotFoundError' });
        // Nothing to roll back: validation runs before any transaction is opened, and long before
        // the gateway is touched.
        expect(dataSource.createQueryRunner).not.toHaveBeenCalled();
        expect(gateway.charge).not.toHaveBeenCalled();
    });

    it('order in a dead state (cancelled) → TicketUnavailableError', async () => {
        manager.findOne.mockResolvedValue(makeOrder({ status: 'cancelled' }));
        await expect(confirm()).rejects.toMatchObject({ name: 'TicketUnavailableError' });
    });

    it('already confirmed → idempotent replay: returns existing tickets, no new sale (§7)', async () => {
        manager.findOne.mockResolvedValue(makeOrder({ status: 'confirmed' }));
        ticketRepo.findTicketsByOrderId.mockResolvedValue([{ id: 'tk1', seatNumber: 'A1' }]);
        const res = await confirm();
        expect(res.tickets).toEqual([{ id: 'tk1', seatNumber: 'A1' }]);
        // Replay path: no claim, NO SECOND CHARGE, no ticket creation, no seat:sold re-broadcast.
        expect(orderRepo.claimOrderForPayment).not.toHaveBeenCalled();
        expect(gateway.charge).not.toHaveBeenCalled();
        expect(ticketRepo.createSoldTicket).not.toHaveBeenCalled();
        expect(eventBus.publishSeatEvent).not.toHaveBeenCalled();
    });

    it('order belongs to another user → TicketUnavailableError', async () => {
        manager.findOne.mockResolvedValue(makeOrder({ user: { id: 'someone-else' } }));
        await expect(confirm()).rejects.toMatchObject({ name: 'TicketUnavailableError' });
    });

    it('order has no reserves → TicketUnavailableError', async () => {
        manager.findOne.mockResolvedValue(makeOrder({ reserves: [] }));
        await expect(confirm()).rejects.toMatchObject({ name: 'TicketUnavailableError' });
    });

    it('a reserve no longer PENDING → TicketUnavailableError, caught before the card is touched', async () => {
        manager.findOne.mockResolvedValue(makeOrder({ reserves: [makeReserve({ status: 'cancelled' })] }));
        await expect(confirm()).rejects.toMatchObject({ name: 'TicketUnavailableError' });
        expect(gateway.charge).not.toHaveBeenCalled();
    });

    it('an expired reserve → ReserveExpiredError, and no charge to refund', async () => {
        manager.findOne.mockResolvedValue(
            makeOrder({ reserves: [makeReserve({ expiresAt: new Date(Date.now() - 1000) })] }),
        );
        await expect(confirm()).rejects.toMatchObject({ name: 'ReserveExpiredError' });
        // Refusing here rather than inside the transaction is the point: charging and immediately
        // refunding a card is a worse outcome than declining to charge it.
        expect(gateway.charge).not.toHaveBeenCalled();
        expect(gateway.refund).not.toHaveBeenCalled();
        expect(eventBus.publishSeatEvent).not.toHaveBeenCalled();
    });

    it('UNIQUE violation creating the ticket → SeatsUnavailableError(sold), rolls back', async () => {
        manager.findOne.mockResolvedValue(makeOrder());
        ticketRepo.createSoldTicket.mockRejectedValue(
            new QueryFailedError('q', undefined, new Error('UNIQUE constraint failed') as any),
        );
        await expect(confirm()).rejects.toMatchObject({
            name: 'SeatsUnavailableError',
            reason: 'sold',
            seatNumbers: ['A1'],
        });
        expect(qr.rollbackTransaction).toHaveBeenCalledTimes(1);
        // The charge already went through, so rolling back is not enough — it has to be undone.
        expect(gateway.refund).toHaveBeenCalledWith('ch_1');
        expect(orderRepo.releasePaymentClaim).toHaveBeenCalledWith({ orderId: 'o1' });
    });

    it('oneTicketPerUser + user already owns a ticket → UserAlreadyHasTicketError', async () => {
        manager.findOne.mockResolvedValue(
            makeOrder({
                reserves: [
                    makeReserve({
                        concert: {
                            id: 'c1',
                            oneTicketPerUser: true,
                            status: ConcertStatus.UPCOMING,
                            concertDate: FUTURE,
                        },
                    }),
                ],
            }),
        );
        ticketRepo.userHasSoldTicketForConcert.mockResolvedValue(true);
        await expect(confirm()).rejects.toMatchObject({ name: 'UserAlreadyHasTicketError' });
    });

    it('concert cancelled while the order was pending → ConcertNotSellableError, rolls back (§3.1)', async () => {
        manager.findOne.mockResolvedValue(
            makeOrder({
                reserves: [
                    makeReserve({
                        concert: {
                            id: 'c1',
                            oneTicketPerUser: false,
                            status: ConcertStatus.CANCELLED,
                            concertDate: FUTURE,
                        },
                    }),
                ],
            }),
        );
        await expect(confirm()).rejects.toMatchObject({ name: 'ConcertNotSellableError' });
        // Checked before the charge: never take money for a concert that can no longer be fulfilled.
        expect(gateway.charge).not.toHaveBeenCalled();
        expect(dataSource.createQueryRunner).not.toHaveBeenCalled();
        expect(eventBus.publishSeatEvent).not.toHaveBeenCalled();
    });

    describe('the payment step', () => {
        it('a decline → PaymentFailedError, claim handed back, nothing written', async () => {
            manager.findOne.mockResolvedValue(makeOrder());
            gateway.charge.mockResolvedValue({ success: false, declineReason: 'card_declined' });

            await expect(confirm()).rejects.toMatchObject({
                name: 'PaymentFailedError',
                declineReason: 'card_declined',
            });

            expect(orderRepo.releasePaymentClaim).toHaveBeenCalledWith({ orderId: 'o1' });
            expect(dataSource.createQueryRunner).not.toHaveBeenCalled();
            expect(ticketRepo.createSoldTicket).not.toHaveBeenCalled();
        });

        it('a provider outage → ServiceUnavailableError, claim handed back, nothing to refund', async () => {
            manager.findOne.mockResolvedValue(makeOrder());
            gateway.charge.mockRejectedValue(new Error('ETIMEDOUT'));

            await expect(confirm()).rejects.toMatchObject({ name: 'ServiceUnavailableError' });

            expect(orderRepo.releasePaymentClaim).toHaveBeenCalledWith({ orderId: 'o1' });
            expect(gateway.refund).not.toHaveBeenCalled();
        });

        it('losing the claim to a concurrent confirm that already settled → idempotent replay', async () => {
            manager.findOne
                .mockResolvedValueOnce(makeOrder())
                .mockResolvedValueOnce(makeOrder({ status: 'confirmed' }));
            orderRepo.claimOrderForPayment.mockResolvedValue(0);
            ticketRepo.findTicketsByOrderId.mockResolvedValue([{ id: 'tk1', seatNumber: 'A1' }]);

            const res = await confirm();

            expect(res.tickets).toEqual([{ id: 'tk1', seatNumber: 'A1' }]);
            expect(gateway.charge).not.toHaveBeenCalled();
        });

        it('losing the claim while another charge is in flight → 409, not a second charge', async () => {
            manager.findOne.mockResolvedValueOnce(makeOrder()).mockResolvedValueOnce(makeOrder({ status: 'paying' }));
            orderRepo.claimOrderForPayment.mockResolvedValue(0);

            await expect(confirm()).rejects.toMatchObject({ name: 'ConflictError', statusCode: 409 });
            expect(gateway.charge).not.toHaveBeenCalled();
        });

        it('settling affects 0 rows (the claim was reclaimed) → unwind and refund', async () => {
            manager.findOne.mockResolvedValue(makeOrder());
            orderRepo.markOrderPaid.mockResolvedValue(0);

            await expect(confirm()).rejects.toMatchObject({ name: 'ConflictError' });

            expect(qr.rollbackTransaction).toHaveBeenCalledTimes(1);
            expect(gateway.refund).toHaveBeenCalledWith('ch_1');
        });

        it('when the refund ALSO fails, the error still surfaces (compensation never masks it)', async () => {
            manager.findOne.mockResolvedValue(makeOrder());
            orderRepo.markOrderPaid.mockResolvedValue(0);
            gateway.refund.mockRejectedValue(new Error('refund endpoint down'));

            // The caller learns what went wrong; the unrecoverable money state is left in PAYING
            // and logged, not thrown on top of the real cause.
            await expect(confirm()).rejects.toMatchObject({ name: 'ConflictError' });
        });
    });
});
