import 'reflect-metadata';
import 'dotenv/config';
import { Server } from 'http';
import { AppDataSource } from './data-source';
import { container } from 'tsyringe';
import { registerDependencies } from './container';
import { IConcertController } from './controllers/ConcertController';
import { IReserveController } from './controllers/ReserveController';
import { IOrderController } from './controllers/OrderController';
import { ISeatController } from './controllers/SeatController';
import { IAuthController } from './controllers/AuthController';
import { IQueueController } from './controllers/QueueController';
import { IQueueService } from './services/QueueService';
import { ISweeperService } from './services/SweeperService';
import { IEventBus } from './services/EventBus';
import { attachSockets } from './sockets/socketServer';
import { createApp } from './app';
import { logger } from './observability/logger';
import { closeRedis } from './redis';
import { beginShutdown, isShuttingDown } from './lifecycle';

// How long in-flight requests get to finish before we stop being polite (ms).
const SHUTDOWN_TIMEOUT_MS = Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 5000);

/**
 * Graceful shutdown with a real DRAIN:
 *  1. flag the process as draining → `/health` starts answering 503 so the load balancer takes this
 *     instance out of rotation before we stop listening,
 *  2. stop background work (sweeper) and the socket server,
 *  3. `server.close()` → stop ACCEPTING new connections, but let in-flight requests finish,
 *  4. `closeIdleConnections()` → hang up keep-alive sockets that are sitting idle, otherwise
 *     `close()` waits on connections that will never send another byte,
 *  5. release the DataSource + Redis and exit 0,
 *  6. …and if the drain overruns the deadline, force the remaining sockets shut and exit 1 rather
 *     than hanging forever (a stuck request must never block a deploy).
 */
function shutdown(signal: string, server: Server, sweeper: ISweeperService, io: ReturnType<typeof attachSockets>) {
    if (isShuttingDown()) return; // a second SIGTERM must not restart the sequence
    beginShutdown();
    logger.info({ signal, timeoutMs: SHUTDOWN_TIMEOUT_MS }, 'shutdown: draining in-flight requests');

    sweeper.stop();
    // void: fire-and-forget. io.close() returns a promise, but the io/server double-close cleanup
    // is tracked separately (CODE_REVIEW §5); marking it void preserves today's behaviour.
    void io.close();

    const releaseResources = () => Promise.allSettled([AppDataSource.destroy(), closeRedis()]);

    server.close(() => {
        clearTimeout(forceTimer);
        releaseResources()
            .then(() => {
                logger.info('shutdown: drained cleanly (Data Source + Redis closed)');
                process.exit(0);
            })
            .catch((error) => {
                logger.error({ err: error }, 'shutdown: error releasing resources');
                process.exit(1);
            });
    });
    // Idle keep-alive sockets would otherwise hold close() open for their full timeout.
    server.closeIdleConnections();

    const forceTimer = setTimeout(() => {
        logger.warn({ timeoutMs: SHUTDOWN_TIMEOUT_MS }, 'shutdown: drain timed out — forcing sockets closed');
        server.closeAllConnections();
        void releaseResources().finally(() => process.exit(1));
    }, SHUTDOWN_TIMEOUT_MS);
    // Don't let the timer itself keep the event loop alive.
    forceTimer.unref();
}

const PORT = process.env.PORT || 3000;
async function startServer() {
    //DB Initailizarion
    try {
        //Database initialization
        await AppDataSource.initialize();
        logger.info('Data Source has been initialized!');
    } catch (error) {
        logger.error({ err: error }, 'Failed to initialize Data Source');
        process.exit(1);
    }
    //Dependency Injection Wiring.
    let app: ReturnType<typeof createApp>;
    let sweeper: ISweeperService;
    let eventBus: IEventBus;
    try {
        //Dependency registration
        registerDependencies();
        const concertController = container.resolve<IConcertController>('IConcertController');
        const reserveController = container.resolve<IReserveController>('IReserveController');
        const orderController = container.resolve<IOrderController>('IOrderController');
        const seatController = container.resolve<ISeatController>('ISeatController');
        const authController = container.resolve<IAuthController>('IAuthController');
        const queueController = container.resolve<IQueueController>('IQueueController');
        const queueService = container.resolve<IQueueService>('IQueueService');
        sweeper = container.resolve<ISweeperService>('ISweeperService');
        eventBus = container.resolve<IEventBus>('IEventBus');
        app = createApp({
            concertController,
            reserveController,
            orderController,
            seatController,
            authController,
            queueController,
            queueService,
        });
    } catch (error) {
        logger.error({ err: error }, 'Failed to wire up dependencies (check container.ts)');
        process.exit(1);
    }

    //Start listneing Server for the income.
    const server = app.listen(PORT, () => {
        logger.info({ port: PORT }, 'Server is running');
    });
    //Attach WebSockets (socket.io): bridge domain seat events -> per-concert rooms.
    const corsOrigins = (process.env.CORS_ORIGINS ?? '')
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean);
    const io = attachSockets(server, eventBus, corsOrigins);
    //Start the background expiry sweeper (cancels expired holds).
    sweeper.start();
    //Handle SIGINT for graceful shutdown in development environments (Ctrl+C)
    process.on('SIGINT', () => shutdown('SIGINT', server, sweeper, io));
    //Handle SIGTERM for graceful shutdown in production environments: (Docker, Kubernetes)
    process.on('SIGTERM', () => shutdown('SIGTERM', server, sweeper, io));
}

startServer().catch((error) => logger.error({ err: error }, 'Unexpected fatal error during server startup'));
