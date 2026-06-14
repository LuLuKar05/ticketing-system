import {Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, OneToMany} from 'typeorm';
import { User } from './User';
import { Concert } from './Concert';
import { Reserve } from './Reserve';
export enum TicketStatus {
    AVAILABLE = 'available',
    SOLD = 'sold',
    CANCELLED = 'cancelled',
}

@Entity()
export class Ticket {
    //PK
    @PrimaryGeneratedColumn('uuid')
    id!: string;
    //Basic info
    @Column({type: 'int', unique: true})
    seatNumber!: number;

    //Ticket Status info
    @Column({ type: 'text', default: TicketStatus.AVAILABLE })
    status!: TicketStatus;

    //Relations
    @ManyToOne(() => Concert, concert => concert.tickets)
    concert!: Concert;
    //A ticket may or may not be associated with a user (if it's been purchased or not)
    @ManyToOne(() => User, user => user.tickets,{nullable: true})
    user!: User | null;
    //A ticket can have multiple reserves
    @OneToMany(() => Reserve, reserve => reserve.ticket)
    reserves!: Reserve[];

    //Timestamps
    @CreateDateColumn()
    createdAt!: Date;
    @UpdateDateColumn()
    updatedAt!: Date;
}