/**
 * PROOF: Phase 3 payment (confirmOrder). Container-resolved services, real DB.
 *   A. hold 2 seats -> confirmOrder -> 2 SOLD tickets, reserves CONFIRMED, order CONFIRMED,
 *      totalAmount correct, tier.quantity decremented by 2.
 *   B. seat sold by someone else after hold -> confirmOrder rolls back (order still PENDING,
 *      tier.quantity unchanged, SeatsUnavailableError 'sold').
 *   C. confirm an already-CONFIRMED order -> TicketUnavailableError.
 *   D. expired hold -> ReserveExpiredError.
 *
 * Run:  npx tsc ; node dist/scripts/proveConfirmOrder.js
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
import { SeatsUnavailableError, TicketUnavailableError, ReserveExpiredError } from '../error';
import type { IReserveService } from '../services/ReserveService';
import type { ITicketService } from '../services/TicketService';
import type { ITicketRepository } from '../repositories/TicketRepository';

const C1 = '00000000-0000-0000-0000-00000conf1rm';
const T1 = '00000000-0000-0000-0000-000000t1ercf';
const U1 = '00000000-0000-0000-0000-0000000us3rc';
const PRICE = 5000;
const START_QTY = 10;

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
        name: 'Confirm',
        concertDate: new Date(),
        description: 'x',
        imageUrl: 'http://x',
        location: 'T',
        artist: ['A'],
        genre: ['rock'],
        totalTickets: START_QTY,
        duration: 120,
        ageRestriction: 0,
        oneTicketPerUser: false,
    } as any);
    await AppDataSource.getRepository(TicketTier).save({
        id: T1,
        name: 'General',
        price: PRICE,
        quantity: START_QTY,
        concert: { id: C1 },
    } as any);
    await AppDataSource.getRepository(User).save({
        id: U1,
        name: 'U',
        email: 'confirm@test.local',
        password: 'x',
        phoneNumber: '0',
        address: 'h',
        dateOfBirth: new Date('1990-01-01'),
    } as any);
}

const qty = async () => (await AppDataSource.getRepository(TicketTier).findOneByOrFail({ id: T1 })).quantity;
const soldCount = async () =>
    AppDataSource.getRepository(Ticket).count({ where: { concert: { id: C1 }, status: 'sold' as any } });

async function main() {
    await AppDataSource.initialize();
    registerDependencies();
    const reserveSvc = container.resolve<IReserveService>('IReserveService');
    const ticketSvc = container.resolve<ITicketService>('ITicketService');
    const ticketRepo = container.resolve<ITicketRepository>('ITicketRepository');

    await cleanup();
    await seed();

    // A. hold 2 -> confirm
    console.log('\n[A] hold A1,A2 then confirmOrder');
    const { order: o1 } = await reserveSvc.reserveTickets({
        userId: U1,
        concertId: C1,
        seats: [
            { tierId: T1, seatNumber: 'A1' },
            { tierId: T1, seatNumber: 'A2' },
        ],
    });
    const res1 = await ticketSvc.confirmOrder({ orderId: o1.id, userId: U1 });
    res1.tickets.length === 2 ? ok('2 tickets issued') : bad('expected 2 tickets, got ' + res1.tickets.length);
    res1.order.status === 'confirmed' ? ok('order CONFIRMED') : bad('order status = ' + res1.order.status);
    res1.order.totalAmount === 2 * PRICE
        ? ok('totalAmount = ' + res1.order.totalAmount)
        : bad('totalAmount = ' + res1.order.totalAmount);
    (await soldCount()) === 2 ? ok('2 SOLD tickets in DB') : bad('sold count = ' + (await soldCount()));
    (await qty()) === START_QTY - 2
        ? ok('tier quantity ' + START_QTY + '->' + (await qty()))
        : bad('tier qty = ' + (await qty()));
    const confirmedReserves = await AppDataSource.getRepository(Reserve).count({
        where: { order: { id: o1.id }, status: 'confirmed' as any },
    });
    confirmedReserves === 2 ? ok('2 reserves CONFIRMED') : bad('confirmed reserves = ' + confirmedReserves);

    // B. seat sold out from under the order -> rollback
    console.log('\n[B] hold X1, then someone else buys X1, then confirmOrder');
    const { order: o2 } = await reserveSvc.reserveTickets({
        userId: U1,
        concertId: C1,
        seats: [{ tierId: T1, seatNumber: 'X1' }],
    });
    await ticketRepo.createSoldTicket({
        concertId: C1,
        seatNumber: 'X1',
        userId: U1,
        ticketTierId: T1,
        pricePaid: PRICE,
        orderId: o2.id,
    }); // simulate other buyer
    const qtyBeforeB = await qty();
    try {
        await ticketSvc.confirmOrder({ orderId: o2.id, userId: U1 });
        bad('expected SeatsUnavailableError, none thrown');
    } catch (e) {
        e instanceof SeatsUnavailableError && e.reason === 'sold'
            ? ok('SeatsUnavailableError sold [' + e.seatNumbers.join(',') + ']')
            : bad('wrong error: ' + (e as Error).message);
    }
    const o2after = await AppDataSource.getRepository(Order).findOneByOrFail({ id: o2.id });
    o2after.status === 'pending' ? ok('order still PENDING (rolled back)') : bad('order status = ' + o2after.status);
    (await qty()) === qtyBeforeB
        ? ok('tier quantity unchanged (rolled back)')
        : bad('tier qty changed ' + qtyBeforeB + '->' + (await qty()));

    // C. double confirm
    console.log('\n[C] confirm an already-confirmed order');
    try {
        await ticketSvc.confirmOrder({ orderId: o1.id, userId: U1 });
        bad('expected TicketUnavailableError, none thrown');
    } catch (e) {
        e instanceof TicketUnavailableError
            ? ok('rejected double-confirm')
            : bad('wrong error: ' + (e as Error).message);
    }

    // D. expired hold
    console.log('\n[D] expired hold');
    const { order: o4 } = await reserveSvc.reserveTickets({
        userId: U1,
        concertId: C1,
        seats: [{ tierId: T1, seatNumber: 'Y1' }],
    });
    await AppDataSource.getRepository(Reserve).update(
        { order: { id: o4.id } },
        { expiresAt: new Date(Date.now() - 1000) },
    );
    try {
        await ticketSvc.confirmOrder({ orderId: o4.id, userId: U1 });
        bad('expected ReserveExpiredError, none thrown');
    } catch (e) {
        e instanceof ReserveExpiredError ? ok('rejected expired hold') : bad('wrong error: ' + (e as Error).message);
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
