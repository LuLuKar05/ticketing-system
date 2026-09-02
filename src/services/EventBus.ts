import { EventEmitter } from 'events';
import { injectable } from 'tsyringe';

export type SeatEventType = 'seat:held' | 'seat:sold' | 'seat:released';

export interface SeatEvent {
    type: SeatEventType;
    concertId: string;
    seatNumbers: string[];
}

/** A user was admitted from a concert's waiting room — pushed to that user's socket. */
export interface QueueEvent {
    type: 'queue:admitted';
    concertId: string;
    userId: string;
}

export interface IEventBus {
    publishSeatEvent(event: SeatEvent): void;
    onSeatEvent(handler: (event: SeatEvent) => void): void;
    publishQueueEvent(event: QueueEvent): void;
    onQueueEvent(handler: (event: QueueEvent) => void): void;
}

/**
 * In-process domain event bus. Services publish seat-state changes here (AFTER commit); a
 * socket bridge (see sockets/socketServer.ts) subscribes and forwards to WebSocket rooms.
 *
 * Services depend only on IEventBus — they never import socket.io, which keeps them testable
 * and lets other subscribers (logging, analytics, …) be added without touching them.
 * MUST be registered as a SINGLETON so publishers and subscribers share one emitter.
 */
@injectable()
export class EventBus implements IEventBus {
    private static readonly SEAT_CHANNEL = 'seat';
    private static readonly QUEUE_CHANNEL = 'queue';
    private readonly emitter = new EventEmitter();

    publishSeatEvent(event: SeatEvent): void {
        this.emitter.emit(EventBus.SEAT_CHANNEL, event);
    }

    onSeatEvent(handler: (event: SeatEvent) => void): void {
        this.emitter.on(EventBus.SEAT_CHANNEL, handler);
    }

    publishQueueEvent(event: QueueEvent): void {
        this.emitter.emit(EventBus.QUEUE_CHANNEL, event);
    }

    onQueueEvent(handler: (event: QueueEvent) => void): void {
        this.emitter.on(EventBus.QUEUE_CHANNEL, handler);
    }
}
