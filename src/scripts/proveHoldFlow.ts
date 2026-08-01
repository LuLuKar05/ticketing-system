/**
 * PROOF: Phase 2 hold flow (hard-hold, create-on-pay).
 *
 * Uses the REAL container-resolved ReserveService against the real sqlite DB.
 *   A. Hold 2 seats            -> Order + 2 PENDING reserves
 *   B. Re-hold one of them     -> SeatsUnavailableError('held', [seat])  (pre-check)
 *   C. Hold a fresh seat       -> succeeds (new Order)
 *   D. oneTicketPerUser, 2 seats -> UserAlreadyHasTicketError
 *   E. oneTicketPerUser, 1 seat  -> succeeds
 *
 * Run:  npm run build ; node dist/scripts/proveHoldFlow.js
 */
import 'reflect-metadata';
import { In } from 'typeorm';
import { AppDataSource } from '../data-source';
import { container } from 'tsyringe';
import { registerDependencies } from '../container';
import { Concert } from '../entities/Concert';
import { TicketTier } from '../entities/TicketTier';
import { User } from '../entities/User';
import { Reserve } from '../entities/Reserve';
import { Order } from '../entities/Order';
import { SeatsUnavailableError, UserAlreadyHasTicketError } from '../error';
import type { IReserveService } from '../services/ReserveService';

const C1 = '00000000-0000-0000-0000-0000000c0nc1'; // multi-seat concert
const C2 = '00000000-0000-0000-0000-0000000c0nc2'; // oneTicketPerUser concert
const T1 = '00000000-0000-0000-0000-0000000t1er1';
const T2 = '00000000-0000-0000-0000-0000000t1er2';
const U1 = '00000000-0000-0000-0000-00000000us3r';

let pass = true;
const ok = (m: string) => console.log('  PASS:', m);
const bad = (m: string) => {
    pass = false;
    console.log('  FAIL:', m);
};

async function cleanup() {
    const ds = AppDataSource;
    await ds
        .createQueryBuilder()
        .delete()
        .from(Reserve)
        .where('concertId IN (:...ids)', { ids: [C1, C2] })
        .execute();
    await ds.createQueryBuilder().delete().from(Order).where('userId = :u', { u: U1 }).execute();
    await ds
        .createQueryBuilder()
        .delete()
        .from(TicketTier)
        .where('concertId IN (:...ids)', { ids: [C1, C2] })
        .execute();
    await ds
        .createQueryBuilder()
        .delete()
        .from(Concert)
        .where('id IN (:...ids)', { ids: [C1, C2] })
        .execute();
    await ds.createQueryBuilder().delete().from(User).where('id = :u', { u: U1 }).execute();
}

async function seed() {
    const baseConcert = {
        name: 'Proof',
        concertDate: new Date(),
        description: 'x',
        imageUrl: 'http://x',
        location: 'Testville',
        artist: ['A'],
        genre: ['rock'],
        totalTickets: 100,
        duration: 120,
        ageRestriction: 0,
    };
    await AppDataSource.getRepository(Concert).save([
        { id: C1, ...baseConcert, oneTicketPerUser: false },
        { id: C2, ...baseConcert, oneTicketPerUser: true },
    ] as any);
    await AppDataSource.getRepository(TicketTier).save([
        { id: T1, name: 'General', price: 5000, quantity: 100, concert: { id: C1 } },
        { id: T2, name: 'General', price: 5000, quantity: 100, concert: { id: C2 } },
    ] as any);
    await AppDataSource.getRepository(User).save({
        id: U1,
        name: 'Proof User',
        email: 'proofhold@test.local',
        password: 'x',
        phoneNumber: '0',
        address: 'here',
        dateOfBirth: new Date('1990-01-01'),
    } as any);
}

async function pendingCount(concertId: string): Promise<number> {
    return AppDataSource.getRepository(Reserve).count({
        where: { concert: { id: concertId }, status: 'pending' as any },
    });
}

async function main() {
    await AppDataSource.initialize();
    registerDependencies();
    const svc = container.resolve<IReserveService>('IReserveService');

    await cleanup();
    await seed();

    // A. hold 2 seats
    console.log('\n[A] hold A1 + A2 (multi-seat concert)');
    const a = await svc.reserveTickets({
        userId: U1,
        concertId: C1,
        seats: [
            { tierId: T1, seatNumber: 'A1' },
            { tierId: T1, seatNumber: 'A2' },
        ],
    });
    a.order && (await pendingCount(C1)) === 2
        ? ok('order created, 2 pending reserves')
        : bad('expected 2 pending reserves, got ' + (await pendingCount(C1)));

    // B. re-hold A1 -> 409 held
    console.log('\n[B] re-hold A1 (already held)');
    try {
        await svc.reserveTickets({ userId: U1, concertId: C1, seats: [{ tierId: T1, seatNumber: 'A1' }] });
        bad('expected SeatsUnavailableError, none thrown');
    } catch (e) {
        e instanceof SeatsUnavailableError && e.reason === 'held' && e.seatNumbers.includes('A1')
            ? ok('SeatsUnavailableError held [' + e.seatNumbers.join(',') + ']')
            : bad('wrong error: ' + (e as Error).message);
    }
    (await pendingCount(C1)) === 2
        ? ok('no extra reserve created (rolled back)')
        : bad('reserve count changed after failed hold');

    // C. hold fresh seat A3
    console.log('\n[C] hold A3 (fresh)');
    await svc.reserveTickets({ userId: U1, concertId: C1, seats: [{ tierId: T1, seatNumber: 'A3' }] });
    (await pendingCount(C1)) === 3
        ? ok('A3 held, 3 pending total')
        : bad('expected 3 pending, got ' + (await pendingCount(C1)));

    // D. oneTicketPerUser with 2 seats -> reject
    console.log('\n[D] oneTicketPerUser: hold 2 seats');
    try {
        await svc.reserveTickets({
            userId: U1,
            concertId: C2,
            seats: [
                { tierId: T2, seatNumber: 'B1' },
                { tierId: T2, seatNumber: 'B2' },
            ],
        });
        bad('expected UserAlreadyHasTicketError, none thrown');
    } catch (e) {
        e instanceof UserAlreadyHasTicketError
            ? ok('rejected multi-seat for oneTicketPerUser')
            : bad('wrong error: ' + (e as Error).message);
    }

    // E. oneTicketPerUser with 1 seat -> ok
    console.log('\n[E] oneTicketPerUser: hold 1 seat');
    await svc.reserveTickets({ userId: U1, concertId: C2, seats: [{ tierId: T2, seatNumber: 'B1' }] });
    (await pendingCount(C2)) === 1
        ? ok('single seat held for oneTicketPerUser')
        : bad('expected 1 pending, got ' + (await pendingCount(C2)));

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
