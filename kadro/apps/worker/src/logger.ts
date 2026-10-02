import { type DestinationStream, type Logger, type LoggerOptions, pino } from 'pino';

/**
 * Paths removed or masked before a log line is written (security checklist item 14).
 * Request bodies are never logged at info level; these paths cover structured fields.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'password',
  '*.password',
  'token',
  '*.token',
  'refreshToken',
  '*.refreshToken',
  'email',
  '*.email',
  // Expo device tokens and message recipients (ADR-0031).
  'to',
  '*.to',
  'expoToken',
  '*.expoToken',
] as const;

const REDACTED = '[REDACTED]';

/** Masks an e-mail address to `a***@d***`, keeping only the first character of each side. */
export function maskEmail(value: unknown): string {
  if (typeof value !== 'string') {
    return REDACTED;
  }
  const at = value.indexOf('@');
  if (at <= 0 || at === value.length - 1) {
    return REDACTED;
  }
  return `${value.charAt(0)}***@${value.charAt(at + 1)}***`;
}

function censor(value: unknown, path: string[]): string {
  return path[path.length - 1] === 'email' ? maskEmail(value) : REDACTED;
}

export interface LoggerConfig {
  readonly level: LoggerOptions['level'];
  readonly buildSha: string;
  readonly appEnv: string;
}

export function createLogger(config: LoggerConfig, destination?: DestinationStream): Logger {
  const options: LoggerOptions = {
    level: config.level,
    base: { service: 'kadro-worker', env: config.appEnv, buildSha: config.buildSha },
    redact: { paths: [...REDACT_PATHS], censor },
    timestamp: pino.stdTimeFunctions.isoTime,
  };
  return destination ? pino(options, destination) : pino(options);
}
