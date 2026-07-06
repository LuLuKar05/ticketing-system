import { QueryFailedError } from 'typeorm';
import { TicketService } from '../../src/services/TicketService';

function makeReserve(over: Record<string, unknown> = {}) {
    return {
        id: 'r1',
        status: 'pending',
        expiresAt: new Date(Date.now() + 60_000),
        seatNumber: 'A1',
        concert: { id: 'c1', oneTicketPerUser: false },
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
    let tierRepo: any;
    let eventBus: any;
    let service: TicketService;

    beforeEach(() => {
        manager = { findOne: jest.fn(), save: jest.fn() };
        qr = {
            connect: jest.fn(), startTransaction: jest.fn(), commitTransaction: jest.fn(),
            rollbackTransaction: jest.fn(), release: jest.fn(), manager,
        };
        dataSource = { createQueryRunner: jest.fn(() => qr) };
        reserveRepo = { updateReserveStatus: jest.fn() };
        ticketRepo = {
            userHasSoldTicketForConcert: jest.fn().mockResolvedValue(false),
            createSoldTicket: jest.fn().mockImplementation((p: any) => Promise.resolve({ seatNumber: p.seatNumber, pricePaid: p.pricePaid })),
        };
        tierRepo = { decrementQuantity: jest.fn() };
        eventBus = { publishSeatEvent: jest.fn() };
        service = new TicketService(dataSource, reserveRepo, ticketRepo, tierRepo, eventBus);
    });

    const confirm = () => service.confirmOrder({ orderId: 'o1', userId: 'u1' });

    it('happy path: creates tickets, confirms reserves, decrements tier, commits, publishes seat:sold', async () => {
        manager.findOne.mockResolvedValue(makeOrder());
        const res = await confirm();
        expect(res.tickets).toHaveLength(1);
        expect(res.order.status).toBe('confirmed');
        expect(res.order.totalAmount).toBe(5000);
        expect(tierRepo.decrementQuantity).toHaveBeenCalledWith('t1', 1, manager);
        expect(reserveRepo.updateReserveStatus).toHaveBeenCalledWith({ id: 'r1', status: 'confirmed' }, manager);
        expect(qr.commitTransaction).toHaveBeenCalledTimes(1);
        expect(qr.release).toHaveBeenCalledTimes(1);
        expect(eventBus.publishSeatEvent).toHaveBeenCalledWith({ type: 'seat:sold', concertId: 'c1', seatNumbers: ['A1'] });
    });

    it('order not found → NotFoundError', async () => {
        manager.findOne.mockResolvedValue(null);
        await expect(confirm()).rejects.toMatchObject({ name: 'NotFoundError' });
        expect(qr.rollbackTransaction).toHaveBeenCalledTimes(1);
    });

    it('order not pending → TicketUnavailableError', async () => {
        manager.findOne.mockResolvedValue(makeOrder({ status: 'confirmed' }));
        await expect(confirm()).rejects.toMatchObject({ name: 'TicketUnavailableError' });
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
        manager.findOne.mockResolvedValue(makeOrder({ reserves: [makeReserve({ expiresAt: new Date(Date.now() - 1000) })] }));
        await expect(confirm()).rejects.toMatchObject({ name: 'ReserveExpiredError' });
        expect(eventBus.publishSeatEvent).not.toHaveBeenCalled();
    });

    it('UNIQUE violation creating the ticket → SeatsUnavailableError(sold), rolls back', async () => {
        manager.findOne.mockResolvedValue(makeOrder());
        ticketRepo.createSoldTicket.mockRejectedValue(new QueryFailedError('q', undefined, new Error('UNIQUE constraint failed') as any));
        await expect(confirm()).rejects.toMatchObject({ name: 'SeatsUnavailableError', reason: 'sold', seatNumbers: ['A1'] });
        expect(qr.rollbackTransaction).toHaveBeenCalledTimes(1);
    });

    it('oneTicketPerUser + user already owns a ticket → UserAlreadyHasTicketError', async () => {
        manager.findOne.mockResolvedValue(makeOrder({ reserves: [makeReserve({ concert: { id: 'c1', oneTicketPerUser: true } })] }));
        ticketRepo.userHasSoldTicketForConcert.mockResolvedValue(true);
        await expect(confirm()).rejects.toMatchObject({ name: 'UserAlreadyHasTicketError' });
    });
});
