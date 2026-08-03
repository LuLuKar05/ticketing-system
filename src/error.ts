/**
 * Base for every domain error. Each subclass declares its machine-readable `code` (surfaced to
 * clients as `{ error: <code> }`) and its HTTP `statusCode`, so the global error middleware maps
 * ALL of them in a single `instanceof AppError` branch instead of a per-error ladder.
 */
export abstract class AppError extends Error {
    abstract readonly code: string;
    abstract readonly statusCode: number;
    constructor(message: string) {
        super(message);
        this.name = new.target.name; // concrete subclass name, e.g. 'NotFoundError'
    }
}

export class TicketUnavailableError extends AppError {
    readonly code = 'TICKET_UNAVAILABLE';
    readonly statusCode = 422;
    constructor(message = 'Ticket is no longer available.') {
        super(message);
    }
}

export class UserAlreadyHasTicketError extends AppError {
    readonly code = 'ALREADY_HAS_TICKET';
    readonly statusCode = 400;
    constructor(message = 'User has already purchased a ticket for this concert.') {
        super(message);
    }
}

export class NotFoundError extends AppError {
    readonly code = 'NOT_FOUND';
    readonly statusCode = 404;
    constructor(message = 'Resource not found.') {
        super(message);
    }
}

export class ReserveExpiredError extends AppError {
    readonly code = 'RESERVE_EXPIRED';
    readonly statusCode = 410;
    constructor(message = 'Reservation has expired.') {
        super(message);
    }
}

export class BadRequestError extends AppError {
    readonly code = 'BAD_REQUEST';
    readonly statusCode = 400;
    constructor(message = 'Bad request.') {
        super(message);
    }
}

export class ConflictError extends AppError {
    readonly code = 'CONFLICT';
    readonly statusCode = 409;
    constructor(message = 'Conflict.') {
        super(message);
    }
}

/**
 * Thrown when a concert can't accept sales because of its lifecycle state — cancelled, past, or
 * otherwise not in a sellable status (see domain/concertRules). Maps to 422: the request is
 * well-formed, but the concert's state makes it unfulfillable.
 */
export class ConcertNotSellableError extends AppError {
    readonly code = 'CONCERT_NOT_SELLABLE';
    readonly statusCode = 422;
    constructor(message = 'This concert is not open for sales.') {
        super(message);
    }
}

/**
 * Thrown when one or more requested seats cannot be held/bought because they are
 * already SOLD (a ticket exists) or HELD (a pending reserve exists). Carries the
 * exact seat numbers + the reason so the client/UX (and the WebSocket) can grey
 * out precisely those seats.
 */
export class SeatsUnavailableError extends AppError {
    readonly code = 'SEATS_UNAVAILABLE';
    readonly statusCode = 409;
    constructor(
        public readonly seatNumbers: string[],
        public readonly reason: 'sold' | 'held',
    ) {
        super(`Seats ${reason}: ${seatNumbers.join(', ')}`);
    }
}
