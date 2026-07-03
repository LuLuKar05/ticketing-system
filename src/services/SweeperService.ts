import { injectable, inject } from 'tsyringe';
import { DataSource } from 'typeorm';
import { IReserveRepository } from '../repositories/ReserveRepository';
import { IOrderRepository } from '../repositories/OrderRepository';

// How often the sweeper runs. Hold TTL is 5 min, so a seat frees ≤ this after expiry.
const SWEEP_INTERVAL_MS = 60 * 1000;

export interface ISweeperService {
    start(): void;
    stop(): void;
    sweepOnce(): Promise<{ reserves: number; orders: number }>;
}

/**
 * Background job (setInterval) that cancels expired PENDING reserves and their now-dead
 * PENDING orders. Status-only, no deletes. Cancelling a hold frees its seat automatically
 * (the seat-uniqueness index only covers status='pending').
 */
@injectable()
export class SweeperService implements ISweeperService {
    private timer: NodeJS.Timeout | null = null;
    private isRunning = false;

    constructor(
        @inject('AppDataSource') private dataSource: DataSource,
        @inject('IReserveRepository') private reserveRepository: IReserveRepository,
        @inject('IOrderRepository') private orderRepository: IOrderRepository,
    ) {}

    start(): void {
        if (this.timer) return;
        this.timer = setInterval(() => { void this.tick(); }, SWEEP_INTERVAL_MS);
        console.log(`Reserve sweeper started (every ${SWEEP_INTERVAL_MS / 1000}s)`);
    }

    stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
            console.log('Reserve sweeper stopped');
        }
    }

    // Interval callback: guards against overlap and never lets an error crash the process.
    private async tick(): Promise<void> {
        if (this.isRunning) return;
        this.isRunning = true;
        try {
            const { reserves, orders } = await this.sweepOnce();
            if (reserves > 0 || orders > 0) {
                console.log(`Sweeper: cancelled ${reserves} expired reserve(s), ${orders} stale order(s)`);
            }
        } catch (err) {
            console.error('Sweeper error:', err);
        } finally {
            this.isRunning = false;
        }
    }

    // One sweep, in a transaction so orders are cancelled based on the post-reserve-cancel state.
    async sweepOnce(): Promise<{ reserves: number; orders: number }> {
        return this.dataSource.transaction(async (manager) => {
            const reserves = await this.reserveRepository.cancelExpiredReserves(new Date(), manager);
            const orders = await this.orderRepository.cancelStalePendingOrders(manager);
            return { reserves, orders };
        });
    }
}
