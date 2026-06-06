import {Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, OneToMany} from 'typeorm';
import { Ticket } from './Ticket';
import { User } from './User';

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

    @Column({type: 'enum', enum: ['upcoming', 'ongoing', 'past', 'cancelled', 'rescheduled']})
    status!: string;

    //Relations
    @OneToMany(() => Ticket, ticket => ticket.concert)// Assuming a concert can have multiple tickets
    tickets!: Ticket[];
    @OneToMany(() => User, user => user.tickets)// Assuming a concert can have multiple users through tickets
    attendees!: User[];
    //Timestamps
    @CreateDateColumn({type: 'timestamp'})
    createdAt!: Date;
    @UpdateDateColumn({type: 'timestamp'})
    updatedAt!: Date;
}