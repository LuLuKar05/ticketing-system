import 'reflect-metadata';
import 'dotenv/config';
import {Server} from 'http';
import { AppDataSource } from './data-source';
import {container} from 'tsyringe';
import {registerDependencies} from './container';
import { IConcertController } from './controllers/ConcertController';
import { IReserveController } from './controllers/ReserveController';
import {createApp} from './app';

function shutdown(signal: string, server: Server){
    console.log(`${signal} signal received: closing HTTP server`);
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
    try{
        //Dependency registration
        registerDependencies();
        const concertController = container.resolve<IConcertController>('IConcertController');
        const reserveController = container.resolve<IReserveController>('IReserveController');
        app = createApp({concertController, reserveController});

    }catch (error) {
        console.error('Failed to wire up dependencies: (Check container.ts)', error);
        process.exit(1);
    }

    //Start listneing Server for the income.
    const server = app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
    //Handle SIGINT for graceful shutdown in development environments (Ctrl+C)
    process.on('SIGINT',() => shutdown('SIGINT', server));
        //Handle SIGTERM for graceful shutdown in production environments: (Docker, Kubernetes)
    process.on('SIGTERM',() => shutdown('SIGTERM', server));

}

startServer().catch((error) => console.error('Unexpected fatal error during the server startup:', error));