import 'reflect-metadata';
import { AppDataSource } from './data-source';
import {container} from 'tsyringe';
import {registerDependencies} from './container';
import { IConcertController } from './controllers/ConcertController';
import { IReserveController } from './controllers/ReserveController';
import {createApp} from './app';

const PORT = process.env.PORT || 3000;


AppDataSource.initialize()
    .then(() => {
        console.log('Data Source has been initialized!');
        registerDependencies();
        const concertController = container.resolve<IConcertController>('IConcertController');
        const reserveController = container.resolve<IReserveController>('IReserveController');
        const app = createApp({concertController, reserveController});
        const server = app.listen(PORT, () => {
            console.log(`Server is running on port ${PORT}`);
        });
        //Handle SIGINT for graceful shutdown in development environments (Ctrl+C)
        process.on('SIGINT',() => {
            console.log('SIGINT signal received: closing HTTP server');
            server.close(() => {
                console.log('Server closed');
                AppDataSource.destroy()
                    .then(() => {
                        console.log('Data Source destroyed');
                        process.exit(0);
                    })
                    .catch((error) => {
                        console.error('Error destroying Data Source:', error);
                        process.exit(1);
                    });
            });    
        });
        //Handle SIGTERM for graceful shutdown in production environments: (Docker, Kubernetes)
        process.on('SIGTERM',() => {
            console.log('SIGTERM signal received: closing HTTP server');
            server.close(() => {
                console.log('HTTP server closed');
                AppDataSource.destroy()
                    .then(() => {
                        console.log('Data Source destroyed');
                        process.exit(0);
                    })
                    .catch((error) => {
                        console.error('Error destroying Data Source:', error);
                        process.exit(1);
                    });
            });
        });

    })
    .catch((error) => console.error('Error initializing Data Source:', error));
