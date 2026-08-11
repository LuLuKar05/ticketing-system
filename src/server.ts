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
import { ISweeperService } from './services/SweeperService';
import { IEventBus } from './services/EventBus';
import { attachSockets } from './sockets/socketServer';
import { createApp } from './app';
import { logger } from './observability/logger';
import { closeRedis } from './redis';

function shutdown(signal: string, server: Server, sweeper: ISweeperService, io: ReturnType<typeof attachSockets>) {
    logger.info({ signal }, 'signal received: closing HTTP server');
    sweeper.stop();
    // void: fire-and-forget. io.close() returns a promise, but the io/server double-close cleanup
    // is tracked separately (CODE_REVIEW §5); marking it void preserves today's behaviour.
    void io.close();
    server.close(() => {
        Promise.allSettled([AppDataSource.destroy(), closeRedis()])
            .then(() => {
                logger.info('Data Source + Redis closed');
                process.exit(0);
            })
            .catch((error) => {
                logger.error({ err: error }, 'Error during shutdown');
                process.exit(1);
            });
    });
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
        sweeper = container.resolve<ISweeperService>('ISweeperService');
        eventBus = container.resolve<IEventBus>('IEventBus');
        app = createApp({ concertController, reserveController, orderController, seatController, authController });
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
