import {Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, OneToMany} from 'typeorm';
import { Ticket } from './Ticket';

export enum ConcertStatus {
    UPCOMING   = 'upcoming',
    ONGOING    = 'ongoing',
    PAST       = 'past',
    CANCELLED  = 'cancelled',
    RESCHEDULED = 'rescheduled'
}
@Entity()
export class Concert {
    //PK
    @PrimaryGeneratedColumn('uuid')
    id!: string;
    //Basic info
    @Column()
    name!: string;
    @Column()
    concertDate!: Date;
    @Column({type: 'text', length: 1000})
    description!: string;
    @Column()
    imageUrl!: string;
    @Column()
    price!: number;
    @Column()
    location!: string;
    @Column({type: 'simple-array'})
    artist!: string[];
    @Column({type: 'simple-array'})
    genre!: string[];

    //Ticketing info
    @Column()
    totalTickets!: number;
    @Column()
    availableTickets!: number;

    //Additional fields
    @Column()
    duration!: number;
    @Column()
    ageRestriction!: number;
    @Column({default: false})
    oneTicketPerUser!: boolean;

    @Column({ type: 'text', default: ConcertStatus.UPCOMING })
    status!: ConcertStatus;

    //Relations
    @OneToMany(() => Ticket, ticket => ticket.concert)// Assuming a concert can have multiple tickets
    tickets!: Ticket[];
    //Timestamps
    @CreateDateColumn()
    createdAt!: Date;
    @UpdateDateColumn()
    updatedAt!: Date;
}