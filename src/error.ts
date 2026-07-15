
export class TicketUnavailableError extends Error {
    constructor(message?: string) {
        super(message || 'Ticket is no longer available.');
        this.name = 'TicketUnavailableError';
    }
}

export class UserAlreadyHasTicketError extends Error {
    constructor(message?: string) {
        super(message || 'User has already purchased a ticket for this concert.');
        this.name = 'UserAlreadyHasTicketError';
    }
}

export class NotFoundError extends Error {
    constructor(message?: string) {
        super(message || 'Resource not found.');
        this.name = 'NotFoundError';
    }
}

export class ReserveExpiredError extends Error {
    constructor(message?: string) {
        super(message || 'Reservation has expired.');
        this.name = 'ReserveExpiredError';
    }
}

export class BadRequestError extends Error {
    constructor(message?: string) {
        super(message || 'Bad request.');
        this.name = 'BadRequestError';
    }
}

export class ConflictError extends Error {
    constructor(message?: string) {
        super(message || 'Conflict.');
        this.name = 'ConflictError';
    }
}

/**
 * Thrown when one or more requested seats cannot be held/bought because they are
 * already SOLD (a ticket exists) or HELD (a pending reserve exists). Carries the
 * exact seat numbers + the reason so the client/UX (and later WebSocket) can grey
 * out precisely those seats.
 */
export class SeatsUnavailableError extends Error {
    constructor(public readonly seatNumbers: string[], public readonly reason: 'sold' | 'held') {
        super(`Seats ${reason}: ${seatNumbers.join(', ')}`);
        this.name = 'SeatsUnavailableError';
    }
}
