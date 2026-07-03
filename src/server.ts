import 'reflect-metadata';
import 'dotenv/config';
import {Server} from 'http';
import { AppDataSource } from './data-source';
import {container} from 'tsyringe';
import {registerDependencies} from './container';
import { IConcertController } from './controllers/ConcertController';
import { IReserveController } from './controllers/ReserveController';
import { IOrderController } from './controllers/OrderController';
import { ISweeperService } from './services/SweeperService';
import {createApp} from './app';

function shutdown(signal: string, server: Server, sweeper: ISweeperService){
    console.log(`${signal} signal received: closing HTTP server`);
    sweeper.stop();
    server.close(()=>{
        AppDataSource.destroy()
        .then(()=>{
            console.log('Data Source destroyed');
            process.exit(0);
        })
        .catch((error)=>{
            console.error('Error destroying Data Source:', error);
            process.exit(1);
        });
    })

}

const PORT = process.env.PORT || 3000;
async function startServer(){
    //DB Initailizarion
    try{
        //Database initialization
        await AppDataSource.initialize();  
        console.log('Data Source has been initialized!');
    }catch (error) {
        console.error('Failed to initialize Data Source:', error);
        process.exit(1);
    }
    //Dependency Injection Wiring.
    let app: ReturnType<typeof createApp>;
    let sweeper: ISweeperService;
    try{
        //Dependency registration
        registerDependencies();
        const concertController = container.resolve<IConcertController>('IConcertController');
        const reserveController = container.resolve<IReserveController>('IReserveController');
        const orderController = container.resolve<IOrderController>('IOrderController');
        sweeper = container.resolve<ISweeperService>('ISweeperService');
        app = createApp({concertController, reserveController, orderController});

    }catch (error) {
        console.error('Failed to wire up dependencies: (Check container.ts)', error);
        process.exit(1);
    }

    //Start listneing Server for the income.
    const server = app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
    //Start the background expiry sweeper (cancels expired holds).
    sweeper.start();
    //Handle SIGINT for graceful shutdown in development environments (Ctrl+C)
    process.on('SIGINT',() => shutdown('SIGINT', server, sweeper));
        //Handle SIGTERM for graceful shutdown in production environments: (Docker, Kubernetes)
    process.on('SIGTERM',() => shutdown('SIGTERM', server, sweeper));

}

startServer().catch((error) => console.error('Unexpected fatal error during the server startup:', error));