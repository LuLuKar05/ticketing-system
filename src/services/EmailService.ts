import { injectable } from 'tsyringe';
import { logger } from '../observability/logger';

export interface IEmailService {
    sendRecoveryCode(email: string, code: string): Promise<void>;
}

/**
 * Dev email transport: logs the message instead of sending it. The app depends only on the
 * IEmailService interface, so a real provider (SES / SendGrid / Resend / SMTP) can be dropped in via
 * DI later without touching any caller — the same seam the payment gateway (Phase 6b) will use.
 */
@injectable()
export class LoggingEmailService implements IEmailService {
    sendRecoveryCode(email: string, code: string): Promise<void> {
        logger.info({ email, code }, 'account recovery code (dev transport: logged, not emailed)');
        return Promise.resolve();
    }
}
