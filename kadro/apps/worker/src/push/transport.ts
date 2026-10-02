import { randomUUID } from 'node:crypto';

import { type WorkerEnv } from '@kadro/config';
import { type Logger } from 'pino';
import { z } from 'zod';

/**
 * Push delivery through the Expo Push API over `fetch` (ADR-0031), or the local `log` transport.
 * Device tokens are never logged; errors carry only the HTTP status.
 */

export const EXPO_API_ORIGIN = 'https://exp.host';
const SEND_PATH = '/--/api/v2/push/send';
const RECEIPTS_PATH = '/--/api/v2/push/getReceipts';
/** Expo accepts up to 100 messages per send request. */
export const EXPO_SEND_BATCH = 100;
/** Expo accepts up to 1 000 ids per receipts request. */
export const EXPO_RECEIPTS_BATCH = 1_000;
const DEFAULT_TIMEOUT_MS = 10_000;

export interface PushMessage {
  readonly to: string;
  readonly title: string;
  readonly body: string;
  readonly data: Readonly<Record<string, string>>;
}

const errorDetailsSchema = z.object({ error: z.string().max(100).optional() }).loose();

const ticketSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), id: z.string().min(1).max(200) }).loose(),
  z
    .object({
      status: z.literal('error'),
      message: z.string().optional(),
      details: errorDetailsSchema.optional(),
    })
    .loose(),
]);
export type PushTicket = z.infer<typeof ticketSchema>;

const receiptSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok') }).loose(),
  z
    .object({
      status: z.literal('error'),
      message: z.string().optional(),
      details: errorDetailsSchema.optional(),
    })
    .loose(),
]);
export type PushReceipt = z.infer<typeof receiptSchema>;

const sendResponseSchema = z.object({ data: z.array(ticketSchema) }).loose();
const receiptsResponseSchema = z.object({ data: z.record(z.string(), receiptSchema) }).loose();

export class PushDeliveryError extends Error {
  constructor(
    readonly reason: 'http_status' | 'timeout' | 'network' | 'invalid_response',
    readonly status?: number,
  ) {
    super(
      status === undefined
        ? `push delivery failed (${reason})`
        : `push delivery failed (${reason} ${status})`,
    );
    this.name = 'PushDeliveryError';
  }

  /** Network, timeout, 429 and 5xx may succeed later; other 4xx are configuration errors. */
  get retryable(): boolean {
    if (this.reason !== 'http_status') {
      return true;
    }
    const status = this.status ?? 0;
    return status === 429 || status >= 500;
  }
}

export interface PushTransport {
  readonly name: 'expo' | 'log';
  /** One ticket per message, in order. At most {@link EXPO_SEND_BATCH} messages. */
  send(messages: readonly PushMessage[], signal?: AbortSignal): Promise<PushTicket[]>;
  /** Receipts by ticket id; ids without a receipt yet are absent. */
  getReceipts(ids: readonly string[], signal?: AbortSignal): Promise<Record<string, PushReceipt>>;
}

export type PushFetch = (
  url: string,
  init: {
    method: 'POST';
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface ExpoTransportOptions {
  readonly accessToken?: string;
  readonly fetch: PushFetch;
  readonly apiOrigin?: string;
  readonly timeoutMs?: number;
}

export function createExpoTransport(options: ExpoTransportOptions): PushTransport {
  const origin = options.apiOrigin ?? EXPO_API_ORIGIN;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function post<T>(
    path: string,
    body: unknown,
    schema: z.ZodType<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response: Awaited<ReturnType<PushFetch>>;
    try {
      response = await options.fetch(new URL(path, origin).toString(), {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
        },
        body: JSON.stringify(body),
        signal: combined,
      });
    } catch {
      throw new PushDeliveryError(timeout.aborted ? 'timeout' : 'network');
    }
    if (!response.ok) {
      throw new PushDeliveryError('http_status', response.status);
    }
    const parsed = schema.safeParse(await response.json().catch(() => undefined));
    if (!parsed.success) {
      throw new PushDeliveryError('invalid_response');
    }
    return parsed.data;
  }

  return {
    name: 'expo',
    async send(messages, signal) {
      if (messages.length === 0) {
        return [];
      }
      if (messages.length > EXPO_SEND_BATCH) {
        throw new Error(`at most ${EXPO_SEND_BATCH} messages per request`);
      }
      const response = await post(
        SEND_PATH,
        messages.map((message) => ({ ...message, sound: 'default', priority: 'high' })),
        sendResponseSchema,
        signal,
      );
      if (response.data.length !== messages.length) {
        throw new PushDeliveryError('invalid_response');
      }
      return response.data;
    },
    async getReceipts(ids, signal) {
      if (ids.length === 0) {
        return {};
      }
      const response = await post(RECEIPTS_PATH, { ids }, receiptsResponseSchema, signal);
      return response.data;
    },
  };
}

/** Local development: logs title and body (fixed templates, no personal data), never the device token. */
export function createLogPushTransport(appEnv: string, logger: Logger): PushTransport {
  if (appEnv !== 'local') {
    throw new Error('the log push transport is only available when APP_ENV=local');
  }
  return {
    name: 'log',
    send(messages) {
      const first = messages[0];
      if (first !== undefined) {
        logger.info(
          { title: first.title, body: first.body, data: first.data, devices: messages.length },
          'push (log transport)',
        );
      }
      return Promise.resolve(messages.map(() => ({ status: 'ok' as const, id: randomUUID() })));
    },
    getReceipts(ids) {
      return Promise.resolve(Object.fromEntries(ids.map((id) => [id, { status: 'ok' as const }])));
    },
  };
}

export type PushTransportEnv = Pick<WorkerEnv, 'APP_ENV' | 'PUSH_TRANSPORT' | 'EXPO_ACCESS_TOKEN'>;

export function createPushTransport(
  env: PushTransportEnv,
  dependencies: { readonly logger: Logger; readonly fetch: PushFetch; readonly apiOrigin?: string },
): PushTransport {
  if (env.PUSH_TRANSPORT === 'log') {
    return createLogPushTransport(env.APP_ENV, dependencies.logger);
  }
  if (env.EXPO_ACCESS_TOKEN === undefined) {
    throw new Error('EXPO_ACCESS_TOKEN is required for the expo push transport');
  }
  return createExpoTransport({
    accessToken: env.EXPO_ACCESS_TOKEN,
    fetch: dependencies.fetch,
    ...(dependencies.apiOrigin ? { apiOrigin: dependencies.apiOrigin } : {}),
  });
}
