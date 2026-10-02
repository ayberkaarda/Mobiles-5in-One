import { type LogLevel } from '@kadro/config';
import { DrizzleQueryError } from 'drizzle-orm';
import { type DestinationStream, type Logger, pino } from 'pino';

import { findPgError } from './errors';

/**
 * Structured logging (security checklist item 14).
 *
 * - Credentials and secrets are replaced with `[Redacted]`; email addresses are masked to
 *   `a***@d***`, wherever they appear up to three levels deep.
 * - Request and response bodies are never logged. The per-request line carries the route
 *   pattern (never the concrete path, which can contain invite codes), method, status, duration,
 *   client type and request id.
 * - Errors are serialized by {@link serializeError}, which drops SQL text and bound parameters.
 * Retention is 30 days at the log sink (docs/ops).
 */

export type { Logger };

const SECRET_FIELDS = [
  'password',
  'newPassword',
  'currentPassword',
  'token',
  'refreshToken',
  'accessToken',
  'idToken',
  'identityToken',
  'csrfToken',
  'totp',
  'code',
  'secret',
] as const;

/** Header accessors in fast-redact path syntax (bracket form for names containing `-`). */
const HEADER_PATHS = [
  '.authorization',
  '.cookie',
  '["set-cookie"]',
  '["x-csrf-token"]',
  '["proxy-authorization"]',
] as const;

function nested(field: string): string[] {
  return [field, `*.${field}`, `*.*.${field}`];
}

/** Paths handed to pino's redaction. Exported so tests can assert the list stays complete. */
export const REDACT_PATHS: readonly string[] = [
  ...HEADER_PATHS.flatMap((header) => [
    `headers${header}`,
    `req.headers${header}`,
    `res.headers${header}`,
  ]),
  ...SECRET_FIELDS.flatMap(nested),
  ...nested('email'),
];

/** `ayberk@example.com` → `a***@e***`. Anything that is not an address is fully hidden. */
export function maskEmail(value: unknown): string {
  if (typeof value !== 'string') {
    return '[Redacted]';
  }
  const at = value.lastIndexOf('@');
  if (at <= 0 || at === value.length - 1) {
    return '***';
  }
  return `${value.charAt(0)}***@${value.charAt(at + 1)}***`;
}

function censor(value: unknown, path: string[]): unknown {
  return path[path.length - 1] === 'email' ? maskEmail(value) : '[Redacted]';
}

const EMAIL_IN_TEXT = /[^\s@<>"'(),;:]+@[^\s@<>"'(),;:]+/g;

/** Masks every email address found in free text such as an error message. */
export function maskEmailsInText(text: string): string {
  return text.replace(EMAIL_IN_TEXT, (match) => maskEmail(match));
}

const MAX_MESSAGE_LENGTH = 500;

interface SerializedError {
  type: string;
  message?: string;
  stack?: string;
  sqlState?: string;
  constraint?: string;
  cause?: SerializedError;
}

/**
 * Log-safe error representation. Database errors keep only the SQLSTATE and constraint name:
 * driver messages and `DrizzleQueryError` messages embed SQL text, bound parameters and
 * offending values. Other errors keep message and stack with email addresses masked.
 */
export function serializeError(error: unknown, depth = 0): SerializedError {
  if (!(error instanceof Error)) {
    return { type: typeof error };
  }
  if (error instanceof DrizzleQueryError) {
    // The message embeds the SQL text and every bound parameter; only the cause is kept.
    return {
      type: 'DrizzleQueryError',
      ...(error.cause === undefined || depth >= 4
        ? {}
        : { cause: serializeError(error.cause, depth + 1) }),
    };
  }
  const result: SerializedError = { type: error.name };
  const pgError = findPgError(error);
  if (pgError !== undefined) {
    // Driver messages and details can quote offending values (`Key (email)=(...)`).
    result.sqlState = pgError.code;
    if (pgError.constraint !== undefined) {
      result.constraint = pgError.constraint;
    }
  } else {
    result.message = maskEmailsInText(error.message).slice(0, MAX_MESSAGE_LENGTH);
    if (error.stack !== undefined) {
      result.stack = maskEmailsInText(error.stack);
    }
  }
  if (error.cause !== undefined && depth < 4) {
    result.cause = serializeError(error.cause, depth + 1);
  }
  return result;
}

export interface LoggerOptions {
  readonly level: LogLevel;
  /** Defaults to standard output. Tests pass an in-memory stream. */
  readonly destination?: DestinationStream;
  readonly base?: Readonly<Record<string, unknown>>;
}

export function createLogger(options: LoggerOptions): Logger {
  return pino(
    {
      level: options.level,
      base: { service: 'kadro-web', ...options.base },
      messageKey: 'msg',
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: { paths: [...REDACT_PATHS], censor },
      serializers: { err: serializeError, error: serializeError },
    },
    options.destination,
  );
}

let fallback: Logger | undefined;

/**
 * Logger used before the validated configuration is available (for example when the
 * configuration itself is invalid). It applies the same redaction rules.
 */
export function fallbackLogger(): Logger {
  fallback ??= createLogger({ level: 'info' });
  return fallback;
}
