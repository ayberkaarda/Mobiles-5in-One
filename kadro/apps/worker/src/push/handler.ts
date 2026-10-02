import { type PushReceiptsJob, type PushSendJob } from '@kadro/contracts';
import { type Database, pushTokens } from '@kadro/db';
import { asc, eq, inArray } from 'drizzle-orm';
import { type PgBoss } from 'pg-boss';

import { type Clock, HOUR_MS, MINUTE_MS } from '../clock.js';
import { enqueue } from '../enqueue.js';
import { hasReceipt, insertReceipt, runOnce } from '../idempotency.js';
import { type JobContext, TransientJobError } from '../job-runner.js';
import { type Metrics } from '../metrics.js';
import { reservePushCapacity } from './cap.js';
import { resolveRecipient } from './recipients.js';
import { PUSH_REF_KEY, renderPush } from './templates.js';
import {
  EXPO_RECEIPTS_BATCH,
  EXPO_SEND_BATCH,
  PushDeliveryError,
  type PushMessage,
  type PushTicket,
  type PushTransport,
} from './transport.js';

/** Receipts are checked 15 minutes after sending (ADR-0031). */
export const RECEIPT_DELAY_MS = 15 * MINUTE_MS;
/** Non-reminder notifications older than this are dropped (ADR-0031). */
export const PUSH_STALE_AFTER_MS = 6 * HOUR_MS;

const SEND_QUEUE = 'push.send';
const RECEIPTS_QUEUE = 'push.receipts';
const TICKET_ID = /^[A-Za-z0-9-]{1,64}$/;

/** Expo error codes handled explicitly; everything else is logged as a ticket or receipt error. */
const DEVICE_NOT_REGISTERED = 'DeviceNotRegistered';
const MESSAGE_RATE_EXCEEDED = 'MessageRateExceeded';

export interface PushHandlerDependencies {
  readonly db: Database;
  readonly boss: PgBoss;
  readonly transport: PushTransport;
  readonly clock: Clock;
  readonly metrics: Metrics;
  readonly hourlyCap: number;
}

function errorCode(ticket: PushTicket): string {
  if (ticket.status !== 'error') {
    return 'none';
  }
  const code = ticket.details?.error;
  return code !== undefined && /^[A-Za-z]{1,60}$/.test(code) ? code : 'Unknown';
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

/** `push.send` (ADR-0031): one notification to every device of one user. */
export function createPushSendHandler(dependencies: PushHandlerDependencies) {
  const { db, boss, transport, clock, metrics } = dependencies;

  return async (job: PushSendJob, context: JobContext): Promise<string> => {
    if (await hasReceipt(db, SEND_QUEUE, job.idempotencyKey)) {
      return 'duplicate';
    }
    const now = clock.now();
    const reminder = job.type === 'match.reminder_24h' || job.type === 'match.reminder_2h';
    if (!reminder && now.getTime() - context.createdOn.getTime() > PUSH_STALE_AFTER_MS) {
      await insertReceipt(db, SEND_QUEUE, job.idempotencyKey);
      return 'skipped_stale';
    }

    const resolution = await resolveRecipient(db, job, now);
    if (!resolution.deliver) {
      await insertReceipt(db, SEND_QUEUE, job.idempotencyKey);
      return `skipped_${resolution.reason}`;
    }

    const devices = await db
      .select({ id: pushTokens.id, expoToken: pushTokens.expoToken })
      .from(pushTokens)
      .where(eq(pushTokens.userId, job.userId))
      .orderBy(asc(pushTokens.id));
    if (devices.length === 0) {
      await insertReceipt(db, SEND_QUEUE, job.idempotencyKey);
      return 'no_devices';
    }

    const reserved = await reservePushCapacity(db, {
      messages: devices.length,
      cap: dependencies.hourlyCap,
      now,
    });
    if (!reserved) {
      metrics.increment('push_capped', { type: job.type });
      await insertReceipt(db, SEND_QUEUE, job.idempotencyKey);
      return 'capped';
    }

    const content = renderPush(job.type, resolution.input);
    const data = { type: job.type, [PUSH_REF_KEY[job.type]]: job.refId };
    const okTickets: { ticketId: string; pushTokenId: string }[] = [];
    const unregistered: string[] = [];
    let rateExceeded = false;

    for (const batch of chunk(devices, EXPO_SEND_BATCH)) {
      const messages: PushMessage[] = batch.map((device) => ({
        to: device.expoToken,
        title: content.title,
        body: content.body,
        data,
      }));
      let tickets: PushTicket[];
      try {
        tickets = await transport.send(messages, context.signal);
      } catch (error) {
        if (error instanceof PushDeliveryError && !error.retryable) {
          metrics.increment('push_ticket_error', { code: `http_${error.status ?? 0}` });
          await insertReceipt(db, SEND_QUEUE, job.idempotencyKey);
          return 'rejected_by_provider';
        }
        throw error instanceof PushDeliveryError ? new TransientJobError(error.message) : error;
      }
      tickets.forEach((ticket, index) => {
        const device = batch.at(index);
        if (device === undefined) {
          return;
        }
        if (ticket.status === 'ok') {
          if (TICKET_ID.test(ticket.id)) {
            okTickets.push({ ticketId: ticket.id, pushTokenId: device.id });
          }
          return;
        }
        const code = errorCode(ticket);
        if (code === DEVICE_NOT_REGISTERED) {
          unregistered.push(device.id);
        } else if (code === MESSAGE_RATE_EXCEEDED) {
          rateExceeded = true;
        } else {
          metrics.increment('push_ticket_error', { code });
        }
      });
    }

    await db.transaction(async (tx) => {
      if (unregistered.length > 0) {
        await tx.delete(pushTokens).where(inArray(pushTokens.id, unregistered));
      }
      for (const [index, tickets] of chunk(okTickets, 100).entries()) {
        const childId = await enqueue(
          boss,
          RECEIPTS_QUEUE,
          { tickets, idempotencyKey: `receipts:${context.jobId}:${index}` },
          { tx, startAfter: new Date(now.getTime() + RECEIPT_DELAY_MS) },
        );
        context.logger.debug({ childQueue: RECEIPTS_QUEUE, childJobId: childId }, 'job enqueued');
      }
      if (!rateExceeded) {
        await insertReceipt(tx, SEND_QUEUE, job.idempotencyKey);
      }
    });

    if (rateExceeded) {
      throw new TransientJobError('expo reported MessageRateExceeded');
    }
    context.logger.info(
      { devices: devices.length, pruned: unregistered.length, tickets: okTickets.length },
      'push sent',
    );
    return 'sent';
  };
}

/** `push.receipts` (ADR-0031): prunes tokens Expo reports as unregistered. */
export function createPushReceiptsHandler(
  dependencies: Pick<PushHandlerDependencies, 'db' | 'transport' | 'metrics'>,
) {
  const { db, transport, metrics } = dependencies;

  return async (job: PushReceiptsJob, context: JobContext): Promise<string> => {
    if (await hasReceipt(db, RECEIPTS_QUEUE, job.idempotencyKey)) {
      return 'duplicate';
    }
    const receipts: Awaited<ReturnType<PushTransport['getReceipts']>> = {};
    for (const batch of chunk(job.tickets, EXPO_RECEIPTS_BATCH)) {
      try {
        Object.assign(
          receipts,
          await transport.getReceipts(
            batch.map((ticket) => ticket.ticketId),
            context.signal,
          ),
        );
      } catch (error) {
        if (error instanceof PushDeliveryError && !error.retryable) {
          metrics.increment('push_receipt_error', { code: `http_${error.status ?? 0}` });
          await insertReceipt(db, RECEIPTS_QUEUE, job.idempotencyKey);
          return 'rejected_by_provider';
        }
        throw error instanceof PushDeliveryError ? new TransientJobError(error.message) : error;
      }
    }

    const unregistered: string[] = [];
    let pending = 0;
    for (const ticket of job.tickets) {
      const receipt = Object.hasOwn(receipts, ticket.ticketId)
        ? receipts[ticket.ticketId]
        : undefined;
      if (receipt === undefined) {
        pending += 1;
      } else if (receipt.status === 'error') {
        const code = errorCode(receipt);
        if (code === DEVICE_NOT_REGISTERED) {
          unregistered.push(ticket.pushTokenId);
        } else {
          metrics.increment('push_receipt_error', { code });
        }
      }
    }

    await runOnce(db, RECEIPTS_QUEUE, job.idempotencyKey, async (tx) => {
      if (unregistered.length > 0) {
        await tx.delete(pushTokens).where(inArray(pushTokens.id, unregistered));
      }
    });
    context.logger.info(
      { tickets: job.tickets.length, pruned: unregistered.length, pending },
      'push receipts checked',
    );
    return 'checked';
  };
}
