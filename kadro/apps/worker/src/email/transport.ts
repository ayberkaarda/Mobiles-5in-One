import { type WorkerEnv } from '@kadro/config';
import {
  type EmailFetch,
  type EmailTransport,
  createLogTransport,
  createResendTransport,
} from '@kadro/emails';
import { type Logger } from 'pino';

import { maskEmail } from '../logger.js';

export type EmailTransportEnv = Pick<
  WorkerEnv,
  'APP_ENV' | 'EMAIL_TRANSPORT' | 'RESEND_API_KEY' | 'EMAIL_FROM'
>;

export interface EmailTransportDependencies {
  readonly logger: Logger;
  readonly fetch: EmailFetch;
  /** Resend API origin; tests point it at a local server. */
  readonly apiOrigin?: string;
}

/** Builds the configured transport; `log` is refused outside `APP_ENV=local` (ADR-0029). */
export function createEmailTransport(
  env: EmailTransportEnv,
  dependencies: EmailTransportDependencies,
): EmailTransport {
  if (env.EMAIL_TRANSPORT === 'log') {
    return createLogTransport({
      appEnv: env.APP_ENV,
      logger: dependencies.logger,
      maskRecipient: maskEmail,
    });
  }
  if (env.RESEND_API_KEY === undefined) {
    throw new Error('RESEND_API_KEY is required for the resend email transport');
  }
  return createResendTransport({
    apiKey: env.RESEND_API_KEY,
    from: env.EMAIL_FROM,
    fetch: dependencies.fetch,
    ...(dependencies.apiOrigin ? { apiOrigin: dependencies.apiOrigin } : {}),
  });
}
