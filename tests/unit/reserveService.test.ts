import { QueryFailedError } from 'typeorm';
import { ReserveService } from '../../src/services/ReserveService';
import { ConcertStatus } from '../../src/entities/Concert';

const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

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
    let seatRepo: any;
    let eventBus: any;
    let service: ReserveService;

    const concert = (over: Record<string, unknown> = {}) => ({
        id: 'c1',
        oneTicketPerUser: false,
        status: ConcertStatus.UPCOMING,
        concertDate: FUTURE,
        ...over,
    });
    const params = (seats = ['A1']) => ({ userId: 'u1', concertId: 'c1', seats });

    beforeEach(() => {
        qr = makeQueryRunner();
        dataSource = { createQueryRunner: jest.fn(() => qr) };
        concertRepo = { findConcertById: jest.fn() };
        orderRepo = { createOrder: jest.fn().mockResolvedValue({ id: 'o1' }) };
        reserveRepo = {
            findHeldSeatNumbers: jest.fn().mockResolvedValue([]),
            createReserve: jest.fn().mockResolvedValue({}),
            cancelExpiredReservesForSeats: jest.fn().mockResolvedValue(0),
            userHasActiveHoldForConcert: jest.fn().mockResolvedValue(false),
        };
        ticketRepo = {
            findSoldSeatNumbers: jest.fn().mockResolvedValue([]),
            userHasSoldTicketForConcert: jest.fn().mockResolvedValue(false),
        };
        // By default every requested seat exists in the catalog and maps to tier 't1'.
        seatRepo = {
            findSeatsByNumbers: jest.fn((_concertId: string, seatNumbers: string[]) =>
                Promise.resolve(seatNumbers.map((seatNumber) => ({ seatNumber, ticketTier: { id: 't1' } }))),
            ),
        };
        eventBus = { publishSeatEvent: jest.fn() };
        service = new ReserveService(dataSource, concertRepo, orderRepo, reserveRepo, ticketRepo, seatRepo, eventBus);
    });

    it('happy path: creates order + reserves, commits, releases, publishes seat:held', async () => {
        concertRepo.findConcertById.mockResolvedValue(concert());
        const res = await service.reserveTickets(params());
        expect(res.order).toEqual({ id: 'o1' });
        expect(qr.commitTransaction).toHaveBeenCalledTimes(1);
        expect(qr.rollbackTransaction).not.toHaveBeenCalled();
        expect(qr.release).toHaveBeenCalledTimes(1);
        expect(eventBus.publishSeatEvent).toHaveBeenCalledWith({
            type: 'seat:held',
            concertId: 'c1',
            seatNumbers: ['A1'],
        });
    });

    it('concert not found → NotFoundError, before any transaction, no publish', async () => {
        concertRepo.findConcertById.mockResolvedValue(null);
        await expect(service.reserveTickets(params())).rejects.toMatchObject({ name: 'NotFoundError' });
        expect(dataSource.createQueryRunner).not.toHaveBeenCalled();
        expect(eventBus.publishSeatEvent).not.toHaveBeenCalled();
    });

    it('cancelled concert → ConcertNotSellableError, before any transaction, no publish (§3.1)', async () => {
        concertRepo.findConcertById.mockResolvedValue(concert({ status: ConcertStatus.CANCELLED }));
        await expect(service.reserveTickets(params())).rejects.toMatchObject({ name: 'ConcertNotSellableError' });
        expect(dataSource.createQueryRunner).not.toHaveBeenCalled();
        expect(eventBus.publishSeatEvent).not.toHaveBeenCalled();
    });

    it('past-dated concert (stale upcoming status) → ConcertNotSellableError (§3.1)', async () => {
        concertRepo.findConcertById.mockResolvedValue(concert({ concertDate: new Date(Date.now() - 1000) }));
        await expect(service.reserveTickets(params())).rejects.toMatchObject({ name: 'ConcertNotSellableError' });
        expect(dataSource.createQueryRunner).not.toHaveBeenCalled();
    });

    it('oneTicketPerUser + more than one seat → UserAlreadyHasTicketError', async () => {
        concertRepo.findConcertById.mockResolvedValue(concert({ oneTicketPerUser: true }));
        await expect(service.reserveTickets(params(['A1', 'A2']))).rejects.toMatchObject({
            name: 'UserAlreadyHasTicketError',
        });
    });

    it('oneTicketPerUser + user already owns a ticket → UserAlreadyHasTicketError, rolls back', async () => {
        concertRepo.findConcertById.mockResolvedValue(concert({ oneTicketPerUser: true }));
        ticketRepo.userHasSoldTicketForConcert.mockResolvedValue(true);
        await expect(service.reserveTickets(params())).rejects.toMatchObject({ name: 'UserAlreadyHasTicketError' });
        expect(qr.rollbackTransaction).toHaveBeenCalledTimes(1);
        expect(qr.release).toHaveBeenCalledTimes(1);
        expect(eventBus.publishSeatEvent).not.toHaveBeenCalled();
    });

    it('seat not in the catalog → BadRequestError, rolls back', async () => {
        concertRepo.findConcertById.mockResolvedValue(concert());
        seatRepo.findSeatsByNumbers.mockResolvedValue([]); // 'A1' not found
        await expect(service.reserveTickets(params())).rejects.toMatchObject({ name: 'BadRequestError' });
        expect(qr.rollbackTransaction).toHaveBeenCalledTimes(1);
        expect(eventBus.publishSeatEvent).not.toHaveBeenCalled();
    });

    it('sold pre-check → SeatsUnavailableError(sold), rolls back', async () => {
        concertRepo.findConcertById.mockResolvedValue(concert());
        ticketRepo.findSoldSeatNumbers.mockResolvedValue(['A1']);
        await expect(service.reserveTickets(params())).rejects.toMatchObject({
            name: 'SeatsUnavailableError',
            reason: 'sold',
            seatNumbers: ['A1'],
        });
        expect(qr.rollbackTransaction).toHaveBeenCalledTimes(1);
    });

    it('held pre-check → SeatsUnavailableError(held)', async () => {
        concertRepo.findConcertById.mockResolvedValue(concert());
        reserveRepo.findHeldSeatNumbers.mockResolvedValue(['A1']);
        await expect(service.reserveTickets(params())).rejects.toMatchObject({
            name: 'SeatsUnavailableError',
            reason: 'held',
        });
    });

    it('UNIQUE violation on INSERT (race backstop) → SeatsUnavailableError(held), rolls back', async () => {
        concertRepo.findConcertById.mockResolvedValue(concert());
        reserveRepo.createReserve.mockRejectedValue(
            new QueryFailedError('q', undefined, new Error('UNIQUE constraint failed') as any),
        );
        await expect(service.reserveTickets(params())).rejects.toMatchObject({
            name: 'SeatsUnavailableError',
            reason: 'held',
            seatNumbers: ['A1'],
        });
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
