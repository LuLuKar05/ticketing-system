import { injectable, inject } from 'tsyringe';
import { DataSource } from 'typeorm';
import { Concert } from '../entities/Concert';
import { TicketTier } from '../entities/TicketTier';
import { Ticket, TicketStatus } from '../entities/Ticket';
import { Reserve, ReserveStatus } from '../entities/Reserve';
import { NotFoundError, BadRequestError, ConflictError } from '../error';
import type { ISeatRepository, INewSeat } from '../repositories/SeatRepository';
import type { IConcertRepository } from '../repositories/ConcertRepository';
import type { ITicketRepository } from '../repositories/TicketRepository';
import type { IReserveRepository } from '../repositories/ReserveRepository';
import type { SeatImportDTO } from '../dtos/seat.dto';

export interface ISeatStatus {
    seatNumber: string;
    section: string | null;
    row: string | null;
    tier: { id: string; name: string; price: number };
    status: 'available' | 'held' | 'sold';
}
export interface ISeatService {
    importSeatMap(concertId: string, dto: SeatImportDTO): Promise<{ inserted: number }>;
    getSeatMapWithStatus(concertId: string): Promise<{ concertId: string; seats: ISeatStatus[] }>;
}

@injectable()
export class SeatService implements ISeatService {
    constructor(
        @inject('AppDataSource') private dataSource: DataSource,
        @inject('ISeatRepository') private seatRepository: ISeatRepository,
        @inject('IConcertRepository') private concertRepository: IConcertRepository,
        @inject('ITicketRepository') private ticketRepository: ITicketRepository,
        @inject('IReserveRepository') private reserveRepository: IReserveRepository,
    ) {}

    /**
     * Admin: full-replace a concert's seat catalog from an uploaded JSON layout.
     * Guarded — you can't repave the venue once any seat is sold or held.
     */
    async importSeatMap(concertId: string, dto: SeatImportDTO): Promise<{ inserted: number }> {
        return this.dataSource.transaction(async (manager) => {
            // 1. Concert must exist.
            const concert = await manager.findOne(Concert, { where: { id: concertId } });
            if (!concert) throw new NotFoundError('Concert not found');

            // 2. Can't replace the layout once seats are committed to.
            const sold = await manager.count(Ticket, { where: { concert: { id: concertId }, status: TicketStatus.SOLD } });
            const held = await manager.count(Reserve, { where: { concert: { id: concertId }, status: ReserveStatus.PENDING } });
            if (sold > 0 || held > 0) {
                throw new ConflictError('Cannot replace the seat map: the concert already has sold or held seats');
            }

            // 3. Resolve each seat's tierName against THIS concert's tiers (rejects a foreign/unknown tier).
            const tiers = await manager.find(TicketTier, { where: { concert: { id: concertId } } });
            const tierIdByName = new Map(tiers.map((t) => [t.name, t.id]));
            const newSeats: INewSeat[] = dto.seats.map((s) => {
                const tierId = tierIdByName.get(s.tierName);
                if (!tierId) throw new BadRequestError(`Unknown tier "${s.tierName}" for this concert`);
                return { seatNumber: s.seatNumber, section: s.section ?? null, rowLabel: s.row ?? null, tierId };
            });

            // 4. Full-replace the catalog.
            await this.seatRepository.replaceSeats(concertId, newSeats, manager);
            return { inserted: newSeats.length };
        });
    }

    /**
     * The availability read model: the seat catalog merged with live state. A seat is SOLD if a
     * ticket exists, HELD if a pending reserve exists, else AVAILABLE. This is the baseline a client
     * renders and then applies `seat:held/sold/released` WS deltas onto.
     */
    async getSeatMapWithStatus(concertId: string): Promise<{ concertId: string; seats: ISeatStatus[] }> {
        const concert = await this.concertRepository.findConcertById(concertId);
        if (!concert) throw new NotFoundError('Concert not found');

        const seats = await this.seatRepository.findSeatsForConcert(concertId);
        const seatNumbers = seats.map((s) => s.seatNumber);
        const sold = new Set(await this.ticketRepository.findSoldSeatNumbers(concertId, seatNumbers));
        const held = new Set(await this.reserveRepository.findHeldSeatNumbers(concertId, seatNumbers));

        return {
            concertId,
            seats: seats.map((s) => ({
                seatNumber: s.seatNumber,
                section: s.section,
                row: s.rowLabel,
                tier: { id: s.ticketTier.id, name: s.ticketTier.name, price: s.ticketTier.price },
                status: sold.has(s.seatNumber) ? 'sold' : held.has(s.seatNumber) ? 'held' : 'available',
            })),
        };
    }
}
