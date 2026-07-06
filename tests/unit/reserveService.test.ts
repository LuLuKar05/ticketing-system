import { QueryFailedError } from 'typeorm';
import { ReserveService } from '../../src/services/ReserveService';

/** A fake queryRunner whose manager is never really used (repos are mocked). */
function makeQueryRunner() {
    return {
        connect: jest.fn(),
        startTransaction: jest.fn(),
        commitTransaction: jest.fn(),
        rollbackTransaction: jest.fn(),
        release: jest.fn(),
        manager: {},
    };
}

describe('ReserveService (unit, mocked dependencies)', () => {
    let qr: ReturnType<typeof makeQueryRunner>;
    let dataSource: any;
    let concertRepo: any;
    let orderRepo: any;
    let reserveRepo: any;
    let ticketRepo: any;
    let eventBus: any;
    let service: ReserveService;

    const concert = (over: Record<string, unknown> = {}) => ({ id: 'c1', oneTicketPerUser: false, ...over });
    const params = (seats = [{ tierId: 't1', seatNumber: 'A1' }]) => ({ userId: 'u1', concertId: 'c1', seats });

    beforeEach(() => {
        qr = makeQueryRunner();
        dataSource = { createQueryRunner: jest.fn(() => qr) };
        concertRepo = { findConcertById: jest.fn() };
        orderRepo = { createOrder: jest.fn().mockResolvedValue({ id: 'o1' }) };
        reserveRepo = { findHeldSeatNumbers: jest.fn().mockResolvedValue([]), createReserve: jest.fn().mockResolvedValue({}) };
        ticketRepo = { findSoldSeatNumbers: jest.fn().mockResolvedValue([]), userHasSoldTicketForConcert: jest.fn().mockResolvedValue(false) };
        eventBus = { publishSeatEvent: jest.fn() };
        service = new ReserveService(dataSource, concertRepo, orderRepo, reserveRepo, ticketRepo, eventBus);
    });

    it('happy path: creates order + reserves, commits, releases, publishes seat:held', async () => {
        concertRepo.findConcertById.mockResolvedValue(concert());
        const res = await service.reserveTickets(params());
        expect(res.order).toEqual({ id: 'o1' });
        expect(qr.commitTransaction).toHaveBeenCalledTimes(1);
        expect(qr.rollbackTransaction).not.toHaveBeenCalled();
        expect(qr.release).toHaveBeenCalledTimes(1);
        expect(eventBus.publishSeatEvent).toHaveBeenCalledWith({ type: 'seat:held', concertId: 'c1', seatNumbers: ['A1'] });
    });

    it('concert not found → NotFoundError, before any transaction, no publish', async () => {
        concertRepo.findConcertById.mockResolvedValue(null);
        await expect(service.reserveTickets(params())).rejects.toMatchObject({ name: 'NotFoundError' });
        expect(dataSource.createQueryRunner).not.toHaveBeenCalled();
        expect(eventBus.publishSeatEvent).not.toHaveBeenCalled();
    });

    it('oneTicketPerUser + more than one seat → UserAlreadyHasTicketError', async () => {
        concertRepo.findConcertById.mockResolvedValue(concert({ oneTicketPerUser: true }));
        await expect(
            service.reserveTickets(params([{ tierId: 't1', seatNumber: 'A1' }, { tierId: 't1', seatNumber: 'A2' }])),
        ).rejects.toMatchObject({ name: 'UserAlreadyHasTicketError' });
    });

    it('oneTicketPerUser + user already owns a ticket → UserAlreadyHasTicketError, rolls back', async () => {
        concertRepo.findConcertById.mockResolvedValue(concert({ oneTicketPerUser: true }));
        ticketRepo.userHasSoldTicketForConcert.mockResolvedValue(true);
        await expect(service.reserveTickets(params())).rejects.toMatchObject({ name: 'UserAlreadyHasTicketError' });
        expect(qr.rollbackTransaction).toHaveBeenCalledTimes(1);
        expect(qr.release).toHaveBeenCalledTimes(1);
        expect(eventBus.publishSeatEvent).not.toHaveBeenCalled();
    });

    it('sold pre-check → SeatsUnavailableError(sold), rolls back', async () => {
        concertRepo.findConcertById.mockResolvedValue(concert());
        ticketRepo.findSoldSeatNumbers.mockResolvedValue(['A1']);
        await expect(service.reserveTickets(params())).rejects.toMatchObject({ name: 'SeatsUnavailableError', reason: 'sold', seatNumbers: ['A1'] });
        expect(qr.rollbackTransaction).toHaveBeenCalledTimes(1);
    });

    it('held pre-check → SeatsUnavailableError(held)', async () => {
        concertRepo.findConcertById.mockResolvedValue(concert());
        reserveRepo.findHeldSeatNumbers.mockResolvedValue(['A1']);
        await expect(service.reserveTickets(params())).rejects.toMatchObject({ name: 'SeatsUnavailableError', reason: 'held' });
    });

    it('UNIQUE violation on INSERT (race backstop) → SeatsUnavailableError(held), rolls back', async () => {
        concertRepo.findConcertById.mockResolvedValue(concert());
        reserveRepo.createReserve.mockRejectedValue(new QueryFailedError('q', undefined, new Error('UNIQUE constraint failed') as any));
        await expect(service.reserveTickets(params())).rejects.toMatchObject({ name: 'SeatsUnavailableError', reason: 'held', seatNumbers: ['A1'] });
        expect(qr.rollbackTransaction).toHaveBeenCalledTimes(1);
        expect(eventBus.publishSeatEvent).not.toHaveBeenCalled();
    });

    it('a non-UNIQUE DB error is rethrown as-is (rolled back)', async () => {
        concertRepo.findConcertById.mockResolvedValue(concert());
        reserveRepo.createReserve.mockRejectedValue(new Error('disk full'));
        await expect(service.reserveTickets(params())).rejects.toThrow('disk full');
        expect(qr.rollbackTransaction).toHaveBeenCalledTimes(1);
    });
});
