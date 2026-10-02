import { type Database } from '@kadro/db';
import { sql } from 'drizzle-orm';
import { PgBoss, type Queue } from 'pg-boss';

import {
  COMPLETED_RETENTION_SECONDS,
  DEAD_LETTER_RETENTION_SECONDS,
  PG_BOSS_SCHEMA,
  type QueueDefinition,
  SCHEDULE_TIME_ZONE,
  WORKER_DB_ROLE,
  deadLetterName,
} from './queues.js';

/** Startup option that makes every session run as `role` (`SET ROLE` at connect). */
export function sessionRoleOption(role: string): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(role)) {
    throw new Error('invalid database role name');
  }
  return `-c role=${role}`;
}

/**
 * Adds the session role to a postgres:// URL so pooled clients created from it (Drizzle) run with
 * the worker role's privileges and create objects owned by it, not by the login user.
 */
export function withSessionRole(connectionString: string, role: string): string {
  const url = new URL(connectionString);
  const existing = url.searchParams.get('options');
  const option = sessionRoleOption(role);
  url.searchParams.set('options', existing ? `${existing} ${option}` : option);
  return url.toString();
}

export interface BossOptions {
  readonly connectionString: string;
  /** Run the pg-boss cron loop in this process (on in production, off in most tests). */
  readonly schedule: boolean;
  readonly role?: string;
  readonly applicationName?: string;
}

export function createBoss(options: BossOptions): PgBoss {
  return new PgBoss({
    connectionString: options.connectionString,
    options: sessionRoleOption(options.role ?? WORKER_DB_ROLE),
    schema: PG_BOSS_SCHEMA,
    // The schema exists already (migration 0010) and the worker role cannot CREATE in the database.
    createSchema: false,
    application_name: options.applicationName ?? 'kadro-worker',
    schedule: options.schedule,
    max: 10,
  });
}

function sourceQueueOptions(definition: QueueDefinition): Omit<Queue, 'name' | 'policy'> {
  return {
    retryLimit: definition.retryLimit,
    retryDelay: definition.retryDelaySeconds,
    retryBackoff: definition.retryBackoff,
    expireInSeconds: definition.expireInSeconds,
    deleteAfterSeconds: COMPLETED_RETENTION_SECONDS,
    retentionSeconds: DEAD_LETTER_RETENTION_SECONDS,
    deadLetter: deadLetterName(definition.name),
  };
}

const DEAD_LETTER_OPTIONS = {
  retryLimit: 0,
  retentionSeconds: DEAD_LETTER_RETENTION_SECONDS,
  deleteAfterSeconds: COMPLETED_RETENTION_SECONDS,
} as const;

/** Payload of the scheduled jobs; their handlers are idempotent by state, not by receipt. */
export function scheduledPayload(queue: string): { idempotencyKey: string } {
  return { idempotencyKey: `schedule:${queue}` };
}

/**
 * Creates or updates every queue and its dead-letter queue (idempotent), registers the cron
 * schedules, then grants the web role its send-only access to the pg-boss tables.
 */
export async function bootstrapQueues(
  boss: PgBoss,
  db: Database,
  definitions: readonly QueueDefinition[],
): Promise<void> {
  for (const definition of definitions) {
    const dead = deadLetterName(definition.name);
    if ((await boss.getQueue(dead)) === null) {
      await boss.createQueue(dead, { policy: 'standard', ...DEAD_LETTER_OPTIONS });
    } else {
      await boss.updateQueue(dead, DEAD_LETTER_OPTIONS);
    }

    const options = sourceQueueOptions(definition);
    if ((await boss.getQueue(definition.name)) === null) {
      await boss.createQueue(definition.name, { policy: 'exclusive', ...options });
    } else {
      await boss.updateQueue(definition.name, options);
    }

    if (definition.cron !== undefined) {
      await boss.schedule(
        definition.name,
        definition.cron,
        { ...definition.scheduleData, ...scheduledPayload(definition.name) },
        { tz: definition.cronTimeZone ?? SCHEDULE_TIME_ZONE },
      );
    }
  }
  await grantSendAccess(db);
}

/** Migration 0010: lets `kadro_app` insert jobs into every queue partition. Repeat per new queue. */
export async function grantSendAccess(db: Database): Promise<void> {
  await db.execute(sql`select public.kadro_grant_pgboss_send_access()`);
}
