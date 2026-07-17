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
    // Per-query logging is a dev tool — opt in via env so containers/prod aren't spammed.
    logging: process.env.DB_LOGGING === 'true',
    entities: [User, Concert, Ticket, Reserve, TicketTier, Order, Seat],
    migrations:['dist/migrations/**/*.js'],
    subscribers: [],
});