//import AppDataSource from 'typeorm';

import { DataSource } from "typeorm";
import { User } from "./entities/User";
import { Concert } from "./entities/Concert";
import { Ticket } from "./entities/Ticket";
import { Reserve } from "./entities/Reserve";

export const AppDataSource = new DataSource({
    type: 'better-sqlite3',
    database: './db/db.sqlite',
    synchronize: false,
    logging: true,
    entities: [User, Concert, Ticket, Reserve],
    migrations:[__dirname+'/src/migrations/**/*.{ts,js}'],
    subscribers: [],
});