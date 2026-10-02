/**
 * Outbound email delivery. Two transports exist:
 *
 * - `resend`: the Resend REST API over `fetch` (no SDK dependency), with a request timeout.
 *   Errors carry only the HTTP status, never the API key, the recipient or the body.
 * - `log`: writes the rendered message, links and tokens included, to the log so a developer can
 *   follow verification and reset links locally. It is refused outside `APP_ENV=local`, here and
 *   by `@kadro/config`.
 */

export const EMAIL_MESSAGE_KINDS = [
  'verify_email',
  'password_reset',
  'already_registered',
  'deletion_scheduled',
  'deletion_completed',
] as const;
export type EmailMessageKind = (typeof EMAIL_MESSAGE_KINDS)[number];

export interface EmailMessage {
  readonly kind: EmailMessageKind;
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

export interface EmailTransport {
  readonly name: 'resend' | 'log';
  /** Resolves when the provider accepted the message; rejects with {@link EmailDeliveryError}. */
  send(message: EmailMessage, signal?: AbortSignal): Promise<void>;
}

/** Minimal `fetch` shape used by the Resend transport; tests inject a stub or a local server. */
export type EmailFetch = (
  url: string,
  init: {
    method: 'POST';
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  },
) => Promise<{ ok: boolean; status: number }>;

export const RESEND_API_ORIGIN = 'https://api.resend.com';
const DEFAULT_TIMEOUT_MS = 10_000;

export type EmailDeliveryFailure = 'http_status' | 'timeout' | 'network';

export class EmailDeliveryError extends Error {
  constructor(
    readonly reason: EmailDeliveryFailure,
    readonly status?: number,
  ) {
    super(
      status === undefined
        ? `email delivery failed (${reason})`
        : `email delivery failed (${reason} ${status})`,
    );
    this.name = 'EmailDeliveryError';
  }

  /**
   * The provider answered with an error status: the message was certainly not accepted. A timeout
   * or network error leaves the outcome unknown (ADR-0029).
   */
  get definite(): boolean {
    return this.reason === 'http_status';
  }

  /** 429 and 5xx may succeed later; any other definite failure will not. */
  get retryable(): boolean {
    if (this.reason !== 'http_status') {
      return true;
    }
    const status = this.status ?? 0;
    return status === 429 || status >= 500;
  }
}

export interface ResendTransportOptions {
  readonly apiKey: string;
  readonly from: string;
  readonly fetch: EmailFetch;
  readonly timeoutMs?: number;
  /** API origin; tests point it at a local server. */
  readonly apiOrigin?: string;
}

export function createResendTransport(options: ResendTransportOptions): EmailTransport {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = new URL('/emails', options.apiOrigin ?? RESEND_API_ORIGIN).toString();
  return {
    name: 'resend',
    async send(message, signal) {
      const timeout = AbortSignal.timeout(timeoutMs);
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
      let response: { ok: boolean; status: number };
      try {
        response = await options.fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: options.from,
            to: [message.to],
            subject: message.subject,
            text: message.text,
            html: message.html,
            tags: [{ name: 'kind', value: message.kind }],
          }),
          signal: combined,
        });
      } catch {
        throw new EmailDeliveryError(timeout.aborted ? 'timeout' : 'network');
      }
      if (!response.ok) {
        throw new EmailDeliveryError('http_status', response.status);
      }
    },
  };
}

/** Structured logger shape accepted by the log transport (pino-compatible). */
export interface EmailLogSink {
  info(fields: Record<string, unknown>, message: string): void;
}

export interface LogTransportOptions {
  readonly appEnv: string;
  readonly logger: EmailLogSink;
  /** Masks the recipient before it is written; the address itself is never logged. */
  readonly maskRecipient: (address: string) => string;
}

export function createLogTransport(options: LogTransportOptions): EmailTransport {
  if (options.appEnv !== 'local') {
    throw new Error('the log email transport is only available when APP_ENV=local');
  }
  return {
    name: 'log',
    send(message) {
      // Local development only: the body carries the link so the flow can be completed without a
      // mail server.
      options.logger.info(
        {
          emailKind: message.kind,
          recipient: options.maskRecipient(message.to),
          subject: message.subject,
          body: message.text,
        },
        'email (log transport)',
      );
      return Promise.resolve();
    },
  };
}
