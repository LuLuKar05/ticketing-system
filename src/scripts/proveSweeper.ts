/**
 * PROOF: Phase 4 expiry sweeper.
 *   A. hold a seat, force it expired, sweepOnce() -> reserve CANCELLED, order CANCELLED,
 *      and the seat is re-holdable afterwards.
 *   B. a fresh (unexpired) hold is NOT swept.
 *
 * Run:  npx tsc ; node dist/scripts/proveSweeper.js
 */
import 'reflect-metadata';
import { AppDataSource } from '../data-source';
import { container } from 'tsyringe';
import { registerDependencies } from '../container';
import { Concert } from '../entities/Concert';
import { TicketTier } from '../entities/TicketTier';
import { User } from '../entities/User';
import { Reserve } from '../entities/Reserve';
import { Order } from '../entities/Order';
import { Ticket } from '../entities/Ticket';
import type { IReserveService } from '../services/ReserveService';
import type { ISweeperService } from '../services/SweeperService';

const C1 = '00000000-0000-0000-0000-000000sweep1';
const T1 = '00000000-0000-0000-0000-0000t1ersweep';
const U1 = '00000000-0000-0000-0000-00000us3rswee';

let pass = true;
const ok = (m: string) => console.log('  PASS:', m);
const bad = (m: string) => {
    pass = false;
    console.log('  FAIL:', m);
};

async function cleanup() {
    const ds = AppDataSource;
    await ds.createQueryBuilder().delete().from(Ticket).where('concertId = :c', { c: C1 }).execute();
    await ds.createQueryBuilder().delete().from(Reserve).where('concertId = :c', { c: C1 }).execute();
    await ds.createQueryBuilder().delete().from(Order).where('userId = :u', { u: U1 }).execute();
    await ds.createQueryBuilder().delete().from(TicketTier).where('concertId = :c', { c: C1 }).execute();
    await ds.createQueryBuilder().delete().from(Concert).where('id = :c', { c: C1 }).execute();
    await ds.createQueryBuilder().delete().from(User).where('id = :u', { u: U1 }).execute();
}

async function seed() {
    await AppDataSource.getRepository(Concert).save({
        id: C1,
        name: 'Sweep',
        concertDate: new Date(),
        description: 'x',
        imageUrl: 'http://x',
        location: 'T',
        artist: ['A'],
        genre: ['rock'],
        totalTickets: 100,
        duration: 120,
        ageRestriction: 0,
        oneTicketPerUser: false,
    } as any);
    await AppDataSource.getRepository(TicketTier).save({
        id: T1,
        name: 'General',
        price: 5000,
        quantity: 100,
        concert: { id: C1 },
    } as any);
    await AppDataSource.getRepository(User).save({
        id: U1,
        name: 'U',
        email: 'sweep@test.local',
        password: 'x',
        phoneNumber: '0',
        address: 'h',
        dateOfBirth: new Date('1990-01-01'),
    } as any);
}

async function main() {
    await AppDataSource.initialize();
    registerDependencies();
    const reserveSvc = container.resolve<IReserveService>('IReserveService');
    const sweeper = container.resolve<ISweeperService>('ISweeperService');
    const reserveRepo = AppDataSource.getRepository(Reserve);
    const orderRepo = AppDataSource.getRepository(Order);

    await cleanup();
    await seed();

    // A. expired hold gets swept, seat frees, order cancelled
    console.log('\n[A] hold S1, force expired, sweepOnce');
    const { order: o1 } = await reserveSvc.reserveTickets({
        userId: U1,
        concertId: C1,
        seats: [{ tierId: T1, seatNumber: 'S1' }],
    });
    await reserveRepo.update({ order: { id: o1.id } }, { expiresAt: new Date(Date.now() - 1000) });

    // B. a fresh hold that must survive the sweep
    console.log('[B] hold S2 (fresh, unexpired)');
    const { order: o2 } = await reserveSvc.reserveTickets({
        userId: U1,
        concertId: C1,
        seats: [{ tierId: T1, seatNumber: 'S2' }],
    });

    const result = await sweeper.sweepOnce();
    console.log(`  sweepOnce -> reserves=${result.reserves}, orders=${result.orders}`);

    const r1 = await reserveRepo.findOneByOrFail({ order: { id: o1.id } } as any);
    r1.status === 'cancelled' ? ok('expired reserve CANCELLED') : bad('reserve status = ' + r1.status);
    const ord1 = await orderRepo.findOneByOrFail({ id: o1.id });
    ord1.status === 'cancelled' ? ok('stale order CANCELLED') : bad('order status = ' + ord1.status);

    const r2 = await reserveRepo.findOneByOrFail({ order: { id: o2.id } } as any);
    r2.status === 'pending'
        ? ok('fresh reserve untouched (still PENDING)')
        : bad('fresh reserve status = ' + r2.status);
    const ord2 = await orderRepo.findOneByOrFail({ id: o2.id });
    ord2.status === 'pending'
        ? ok('fresh order untouched (still PENDING)')
        : bad('fresh order status = ' + ord2.status);

    // seat S1 should be re-holdable now
    console.log('[C] re-hold S1 after sweep');
    try {
        await reserveSvc.reserveTickets({ userId: U1, concertId: C1, seats: [{ tierId: T1, seatNumber: 'S1' }] });
        ok('S1 re-held successfully (seat freed)');
    } catch (e) {
        bad('could not re-hold S1: ' + (e as Error).message);
    }

    await cleanup();
    await AppDataSource.destroy();
    console.log(`\n=== ${pass ? 'ALL PASSED ✅' : 'FAILED ❌'} ===`);
    process.exit(pass ? 0 : 1);
}

main().catch(async (e) => {
    console.error('Script error:', e);
    try {
        await AppDataSource.destroy();
    } catch {}
    process.exit(1);
});
