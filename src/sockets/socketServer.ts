import { Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { IEventBus } from '../services/EventBus';

/**
 * Attach a socket.io server to the HTTP server and bridge domain seat events → rooms.
 *
 * - Clients join a per-concert room by emitting `join` with `{ concertId }`.
 * - The bridge forwards each SeatEvent to `concert:<id>` as a distinct WS event
 *   (`seat:held` / `seat:sold` / `seat:released`), so a client can subscribe to exactly
 *   the transitions it cares about.
 */
export function attachSockets(httpServer: HttpServer, eventBus: IEventBus, corsOrigins: string[]): SocketIOServer {
    const io = new SocketIOServer(httpServer, {
        cors: { origin: corsOrigins, methods: ['GET', 'POST'] },
    });

    io.on('connection', (socket) => {
        socket.on('join', (payload: { concertId?: string }) => {
            // void: join/leave are typed void|Promise (adapter-dependent); fire-and-forget is intended.
            if (payload?.concertId) void socket.join(`concert:${payload.concertId}`);
        });
        socket.on('leave', (payload: { concertId?: string }) => {
            if (payload?.concertId) void socket.leave(`concert:${payload.concertId}`);
        });
    });

    // Bridge: one WS event name per status, delivered only to that concert's room.
    eventBus.onSeatEvent((event) => {
        io.to(`concert:${event.concertId}`).emit(event.type, {
            concertId: event.concertId,
            seatNumbers: event.seatNumbers,
        });
    });

    return io;
}
