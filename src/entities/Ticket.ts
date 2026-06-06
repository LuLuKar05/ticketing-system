import {Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToOne, ManyToOne} from 'typeorm';
import { User } from './User';
import { Concert } from './Concert';


@Entity()
export class Ticket {
    //PK
    @PrimaryGeneratedColumn('uuid')
    id!: string;
    //Basic info
    @Column({type: 'text', length: 255})
    title!: string;
    @Column({type: 'date'})
    date!: Date;
    @Column({type: 'int'})
    seatNumber!: number;

    //Ticket Status info
    @Column({type: 'boolean'})
    isValid!: boolean;

    //Relations
    @ManyToOne(() => Concert, concert => concert.tickets)
    concert!: Concert;
    @ManyToOne(() => User, user => user.tickets)
    user!: User; // user ID, assuming a ticket can only belong to one user

    //Timestamps
    @CreateDateColumn({type: 'timestamp'})
    createdAt!: Date;
    @UpdateDateColumn({type: 'timestamp'})
    updatedAt!: Date;
}