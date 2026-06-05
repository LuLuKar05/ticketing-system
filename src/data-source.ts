//import AppDataSource from 'typeorm';

import { DataSource } from "typeorm";

export const AppDataSource = new DataSource({
    type: 'better-sqlite3',
    database: './db/db.sqlite',
    synchronize: false,
    logging: true,
    entities: ['src/entities/**/*.ts'],
    migrations: ['src/migrations/**/*.ts'],
    subscribers: ['src/subscribers/**/*.ts'],
});