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
        dataSource = { createQueryRunner: jest.fn(() => qr) };
        reserveRepo = { updateReserveStatus: jest.fn() };
        ticketRepo = {
            userHasSoldTicketForConcert: jest.fn().mockResolvedValue(false),
            createSoldTicket: jest
                .fn()
                .mockImplementation((p: any) => Promise.resolve({ seatNumber: p.seatNumber, pricePaid: p.pricePaid })),
            findTicketsByOrderId: jest.fn().mockResolvedValue([]),
        };
        // Compare-and-set claim wins by default (1 row affected).
        orderRepo = { claimOrderForConfirm: jest.fn().mockResolvedValue(1) };
        eventBus = { publishSeatEvent: jest.fn() };
        queueService = { release: jest.fn().mockResolvedValue(undefined) };
        service = new TicketService(dataSource, reserveRepo, ticketRepo, orderRepo, eventBus, queueService);
    });

    const confirm = () => service.confirmOrder({ orderId: 'o1', userId: 'u1' });

    it('happy path: creates tickets, confirms reserves, commits, publishes seat:sold', async () => {
        manager.findOne.mockResolvedValue(makeOrder());
        const res = await confirm();
        expect(res.tickets).toHaveLength(1);
        expect(res.order.status).toBe('confirmed');
        expect(res.order.totalAmount).toBe(5000);
        expect(reserveRepo.updateReserveStatus).toHaveBeenCalledWith({ id: 'r1', status: 'confirmed' }, manager);
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
        expect(qr.rollbackTransaction).toHaveBeenCalledTimes(1);
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
        // Replay path: no claim, no ticket creation, no seat:sold re-broadcast.
        expect(orderRepo.claimOrderForConfirm).not.toHaveBeenCalled();
        expect(ticketRepo.createSoldTicket).not.toHaveBeenCalled();
        expect(eventBus.publishSeatEvent).not.toHaveBeenCalled();
        expect(qr.commitTransaction).toHaveBeenCalledTimes(1);
    });

    it('order belongs to another user → TicketUnavailableError', async () => {
        manager.findOne.mockResolvedValue(makeOrder({ user: { id: 'someone-else' } }));
        await expect(confirm()).rejects.toMatchObject({ name: 'TicketUnavailableError' });
    });

    it('order has no reserves → TicketUnavailableError', async () => {
        manager.findOne.mockResolvedValue(makeOrder({ reserves: [] }));
        await expect(confirm()).rejects.toMatchObject({ name: 'TicketUnavailableError' });
    });

    it('a reserve no longer PENDING → TicketUnavailableError', async () => {
        manager.findOne.mockResolvedValue(makeOrder({ reserves: [makeReserve({ status: 'cancelled' })] }));
        await expect(confirm()).rejects.toMatchObject({ name: 'TicketUnavailableError' });
    });

    it('an expired reserve → ReserveExpiredError', async () => {
        manager.findOne.mockResolvedValue(
            makeOrder({ reserves: [makeReserve({ expiresAt: new Date(Date.now() - 1000) })] }),
        );
        await expect(confirm()).rejects.toMatchObject({ name: 'ReserveExpiredError' });
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
        expect(qr.rollbackTransaction).toHaveBeenCalledTimes(1);
        expect(eventBus.publishSeatEvent).not.toHaveBeenCalled();
    });
});
