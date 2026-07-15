//import AppDataSource from 'typeorm';

import { DataSource } from "typeorm";
import { User } from "./entities/User";
import { Concert } from "./entities/Concert";
import { Ticket } from "./entities/Ticket";
import { Reserve } from "./entities/Reserve";
import { TicketTier } from "./entities/TicketTier";
import { Order } from "./entities/Order";
import { Seat } from "./entities/Seat";

export const AppDataSource = new DataSource({
    type: 'better-sqlite3',
    database: './db/db.sqlite',
    synchronize: false,
    logging: true,
    entities: [User, Concert, Ticket, Reserve, TicketTier, Order, Seat],
    migrations:['dist/migrations/**/*.js'],
    subscribers: [],
});