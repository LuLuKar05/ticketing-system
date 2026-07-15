import { injectable, inject } from 'tsyringe';
import { DataSource } from 'typeorm';
import { Concert } from '../entities/Concert';
import { TicketTier } from '../entities/TicketTier';
import { Ticket, TicketStatus } from '../entities/Ticket';
import { Reserve, ReserveStatus } from '../entities/Reserve';
import { NotFoundError, BadRequestError, ConflictError } from '../error';
import type { ISeatRepository, INewSeat } from '../repositories/SeatRepository';
import type { SeatImportDTO } from '../dtos/seat.dto';

export interface ISeatService {
    importSeatMap(concertId: string, dto: SeatImportDTO): Promise<{ inserted: number }>;
}

@injectable()
export class SeatService implements ISeatService {
    constructor(
        @inject('AppDataSource') private dataSource: DataSource,
        @inject('ISeatRepository') private seatRepository: ISeatRepository,
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
}
