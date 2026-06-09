
export class TicketUnavailableError extends Error {
    constructor() {
        super('Ticket is no longer available.');
        this.name = 'TicketUnavailableError';
    }
}
export class UserAlreadyHasTicketError extends Error {
    constructor() {
        super('User has already purchased a ticket for this concert.');
        this.name = 'UserAlreadyHasTicketError';
    }
}
