import { Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { IEventBus } from '../services/EventBus';
import { verifyAccessToken } from '../auth/jwt';
import { SESSION_COOKIE_NAME } from '../auth/cookie';

export interface SocketUser {
    id: string;
    role: string;
}

interface HandshakeLike {
    auth?: { token?: unknown };
    headers: { cookie?: string };
}

function parseCookies(header?: string): Record<string, string> {
    const out: Record<string, string> = {};
    (header ?? '').split(';').forEach((part) => {
        const eq = part.indexOf('=');
        if (eq > 0) out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
    });
    return out;
}

/**
 * Resolve the authenticated user for a socket handshake, or null for an anonymous connection.
 *
 * The token is taken from the `access_token` cookie (browsers) or a `handshake.auth.token` field
 * (other clients). Auth is OPTIONAL-BUT-VERIFIED: an absent token is allowed (the seat map is public,
 * so a not-yet-logged-in visitor can still watch live availability), but a PRESENT-but-invalid token
 * throws — the caller rejects that connection rather than silently treating it as anonymous.
 */
export function resolveSocketUser(handshake: HandshakeLike): SocketUser | null {
    const fromAuth = typeof handshake.auth?.token === 'string' ? handshake.auth.token : undefined;
    const token = fromAuth ?? parseCookies(handshake.headers.cookie)[SESSION_COOKIE_NAME];
    if (!token) return null;
    const claims = verifyAccessToken(token); // throws on an invalid/expired token
    return { id: claims.sub, role: claims.role };
}

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

    // Handshake auth: verify a session token if one is present (→ socket.data.user for per-user
    // features like the waiting-room queue); reject an invalid token; allow anonymous otherwise.
    io.use((socket, next) => {
        try {
            const user = resolveSocketUser(socket.handshake);
            if (user) (socket.data as { user?: SocketUser }).user = user;
            next();
        } catch {
            next(new Error('unauthorized'));
        }
    });

    io.on('connection', (socket) => {
        // Authenticated sockets join a per-user room so we can push them personal events (e.g. the
        // waiting-room "you're in" notification). Public sockets just watch concert rooms.
        const user = (socket.data as { user?: SocketUser }).user;
        if (user) void socket.join(`user:${user.id}`);

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

    // Bridge: waiting-room events → that user's personal room ("you're in" / "you moved up").
    eventBus.onQueueEvent((event) => {
        const payload =
            event.type === 'queue:position'
                ? { concertId: event.concertId, position: event.position }
                : { concertId: event.concertId };
        io.to(`user:${event.userId}`).emit(event.type, payload);
    });

    return io;
}
