import { type ScheduledJob } from '@kadro/contracts';
import { type Database, jobReceipts, rateLimitBuckets } from '@kadro/db';
import { and, count, eq, gte, lt, sql } from 'drizzle-orm';

import { type Clock, DAY_MS } from '../clock.js';
import { type JobContext, describeError } from '../job-runner.js';
import { type Metrics } from '../metrics.js';
import { PUSH_CAP_KEY } from '../push/cap.js';

/**
 * `cost.guard` (ADR-0081): every 15 minutes it recomputes usage from counters the senders already
 * keep, warns at 80 % of a threshold and, at 100 %, closes the gate of that kind until the next UTC
 * midnight. Senders skip deferrable messages while the gate is closed; essential messages never
 * read it. State lives in `rate_limit_buckets` rows keyed to the UTC day, so a gate releases
 * itself at midnight and the 80 % / 100 % alerts fire once per day and threshold.
 */

export const USAGE_KINDS = ['email', 'push'] as const;
export type UsageKind = (typeof USAGE_KINDS)[number];

/** `day` is the current UTC day; `30d` the rolling 30 days ending now. */
export type UsagePeriod = 'day' | '30d';

export type MeterLevel = 'disabled' | 'ok' | 'warning' | 'exceeded';

/** Warning at 80 % of a threshold: `used / cap >= 4 / 5`, compared in integers. */
const WARNING_NUMERATOR = 4;
const WARNING_DENOMINATOR = 5;

/** The rolling e-mail window; job receipts are kept exactly this long (maintenance sweep). */
export const ROLLING_WINDOW_MS = 30 * DAY_MS;

export interface CostCaps {
  readonly emailDaily: number;
  readonly emailMonthly: number;
  readonly pushDaily: number;
}

export interface Usage {
  /** `email.send` jobs finished today (UTC), whatever their outcome: an upper bound of sends. */
  readonly emailDay: number;
  readonly emailRolling30d: number;
  /** Push messages reserved today (UTC) against the hourly cap, one per device. */
  readonly pushDay: number;
}

export interface Meter {
  readonly kind: UsageKind;
  readonly period: UsagePeriod;
  readonly used: number;
  readonly cap: number;
}

export function meterLevel(used: number, cap: number): MeterLevel {
  if (cap <= 0) {
    return 'disabled';
  }
  if (used >= cap) {
    return 'exceeded';
  }
  return used * WARNING_DENOMINATOR >= cap * WARNING_NUMERATOR ? 'warning' : 'ok';
}

export function utcDayStart(now: Date): Date {
  return new Date(Math.floor(now.getTime() / DAY_MS) * DAY_MS);
}

export function nextUtcMidnight(now: Date): Date {
  return new Date(utcDayStart(now).getTime() + DAY_MS);
}

export function meters(usage: Usage, caps: CostCaps): Meter[] {
  return [
    { kind: 'email', period: 'day', used: usage.emailDay, cap: caps.emailDaily },
    { kind: 'email', period: '30d', used: usage.emailRolling30d, cap: caps.emailMonthly },
    { kind: 'push', period: 'day', used: usage.pushDay, cap: caps.pushDaily },
  ];
}

const GATE_KEYS: Readonly<Record<UsageKind, string>> = {
  email: 'cost:gate:email',
  push: 'cost:gate:push',
};

export function gateKey(kind: UsageKind): string {
  // eslint-disable-next-line security/detect-object-injection -- kind is a typed UsageKind key
  return GATE_KEYS[kind];
}

export function alertKey(meter: Meter, level: 'warning' | 'exceeded'): string {
  return `cost:alert:${meter.kind}:${meter.period}:${level}`;
}

type Executor = Pick<Database, 'select' | 'insert'>;

/** Inserts a marker row for today; `true` only for the call that created it. */
async function markToday(db: Executor, key: string, now: Date): Promise<boolean> {
  const rows = await db
    .insert(rateLimitBuckets)
    .values({ key, windowStart: utcDayStart(now), count: 1, updatedAt: now })
    .onConflictDoNothing({ target: [rateLimitBuckets.key, rateLimitBuckets.windowStart] })
    .returning({ id: rateLimitBuckets.id });
  return rows.length > 0;
}

/** Closes the gate of `kind` until the next UTC midnight; `true` if it was open. */
export function closeGate(db: Executor, kind: UsageKind, now: Date): Promise<boolean> {
  return markToday(db, gateKey(kind), now);
}

/** Whether deferrable sends of `kind` are paused at `now`. */
export async function isSendPaused(db: Executor, kind: UsageKind, now: Date): Promise<boolean> {
  const rows = await db
    .select({ id: rateLimitBuckets.id })
    .from(rateLimitBuckets)
    .where(
      and(
        eq(rateLimitBuckets.key, gateKey(kind)),
        eq(rateLimitBuckets.windowStart, utcDayStart(now)),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export interface UsageReader {
  read(now: Date): Promise<Usage>;
}

/** Reads the counters the senders keep: `job_receipts` of `email.send` and the push cap windows. */
export function createDbUsageReader(db: Database): UsageReader {
  const emailJobsBetween = async (from: Date, to: Date): Promise<number> => {
    const [row] = await db
      .select({ value: count() })
      .from(jobReceipts)
      .where(
        and(
          eq(jobReceipts.queue, 'email.send'),
          gte(jobReceipts.createdAt, from),
          lt(jobReceipts.createdAt, to),
        ),
      );
    return row?.value ?? 0;
  };

  return {
    async read(now) {
      const dayStart = utcDayStart(now);
      const dayEnd = nextUtcMidnight(now);
      const [push] = await db
        .select({ value: sql<string>`coalesce(sum(${rateLimitBuckets.count}), 0)` })
        .from(rateLimitBuckets)
        .where(
          and(
            eq(rateLimitBuckets.key, PUSH_CAP_KEY),
            gte(rateLimitBuckets.windowStart, dayStart),
            lt(rateLimitBuckets.windowStart, dayEnd),
          ),
        );
      return {
        emailDay: await emailJobsBetween(dayStart, dayEnd),
        emailRolling30d: await emailJobsBetween(
          new Date(now.getTime() - ROLLING_WINDOW_MS),
          new Date(now.getTime() + 1),
        ),
        pushDay: Number(push?.value ?? 0),
      };
    },
  };
}

export interface CostGuardDependencies {
  readonly db: Database;
  readonly clock: Clock;
  readonly metrics: Metrics;
  readonly caps: CostCaps;
  /** Replaces the database reader (tests inject a failing one). */
  readonly reader?: UsageReader;
}

export function createCostGuardHandler(dependencies: CostGuardDependencies) {
  const { db, clock, metrics, caps } = dependencies;
  const reader = dependencies.reader ?? createDbUsageReader(db);

  return async (_job: ScheduledJob, context: JobContext): Promise<string> => {
    const now = clock.now();
    const pausedUntil = nextUtcMidnight(now).toISOString();

    let usage: Usage;
    try {
      usage = await reader.read(now);
    } catch (error) {
      // Fail closed for deferrable sends only: essential messages never read the gate.
      metrics.increment('cost_guard_failed', { reason: 'read_usage' });
      context.logger.error(
        { ...describeError(error), pausedUntil },
        'usage counters unreadable; pausing deferrable sends',
      );
      for (const kind of USAGE_KINDS) {
        await closeGate(db, kind, now).catch((gateError: unknown) => {
          context.logger.error({ ...describeError(gateError), kind }, 'could not close send gate');
        });
      }
      return 'failed_closed';
    }

    const exceeded = new Set<UsageKind>();
    let warned = false;
    const summary: Record<string, string> = {};
    for (const meter of meters(usage, caps)) {
      const level = meterLevel(meter.used, meter.cap);
      summary[`${meter.kind}_${meter.period}`] = `${meter.used}/${meter.cap} ${level}`;
      if (level !== 'warning' && level !== 'exceeded') {
        continue;
      }
      warned = true;
      if (level === 'exceeded') {
        exceeded.add(meter.kind);
      }
      if (await markToday(db, alertKey(meter, level), now)) {
        metrics.increment('cost_threshold', { kind: meter.kind, period: meter.period, level });
        const fields = { kind: meter.kind, period: meter.period, used: meter.used, cap: meter.cap };
        if (level === 'exceeded') {
          context.logger.error(
            { ...fields, threshold: level, pausedUntil },
            'usage threshold exceeded',
          );
        } else {
          context.logger.warn({ ...fields, threshold: level }, 'usage threshold at 80 percent');
        }
      }
    }

    for (const kind of exceeded) {
      if (await closeGate(db, kind, now)) {
        context.logger.warn({ kind, pausedUntil }, 'deferrable sends paused');
      }
    }
    context.logger.info(summary, 'usage checked');
    return exceeded.size > 0 ? 'paused' : warned ? 'warning' : 'ok';
  };
}
