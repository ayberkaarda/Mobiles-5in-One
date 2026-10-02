import { randomBytes } from 'node:crypto';

import { type EmailSendJob } from '@kadro/contracts';
import { deletionRequests, emailTokens, jobReceipts, newId, users } from '@kadro/db';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { HOUR_MS } from '../src/clock.js';
import { createEmailTransport } from '../src/email/transport.js';
import { sha256Hex } from '../src/email/tokens.js';
import { enqueue } from '../src/enqueue.js';
import { createLogger } from '../src/logger.js';
import {
  type FakeProvider,
  Fixtures,
  MutableClock,
  RESEND_PATH,
  type TestDatabase,
  type TestWorker,
  createTestDatabase,
  jobsIn,
  startFakeProvider,
  startTestWorker,
  waitFor,
  waitForJobState,
} from './support.js';

let database: TestDatabase;
let provider: FakeProvider;
let worker: TestWorker;
let fixtures: Fixtures;
const clock = new MutableClock(new Date());

beforeAll(async () => {
  database = await createTestDatabase('worker_email');
  provider = await startFakeProvider();
  worker = await startTestWorker(database, provider, {
    clock,
    queueOverrides: { 'email.send': { retryLimit: 2, retryDelaySeconds: 1, retryBackoff: false } },
  });
  fixtures = new Fixtures(database.admin.db);
});

afterAll(async () => {
  await worker.runtime.stop();
  await provider.close();
  await database.dispose();
});

beforeEach(() => {
  clock.set(new Date());
  provider.requests.length = 0;
  provider.responders.set(RESEND_PATH, () => ({ status: 200, body: { id: newId() } }));
});

function requestId(): string {
  return `req_${randomBytes(6).toString('hex')}`;
}

async function sendEmail(
  kind: EmailSendJob['kind'],
  userId: string | null,
  idempotencyKey = `email:${kind}:${userId ?? 'none'}:${newId()}`,
): Promise<{ jobId: string; idempotencyKey: string }> {
  const jobId = await enqueue(worker.runtime.boss, 'email.send', {
    kind,
    userId,
    requestId: requestId(),
    idempotencyKey,
  });
  if (jobId === null) {
    throw new Error('expected a new job');
  }
  return { jobId, idempotencyKey };
}

async function completed(jobId: string) {
  return waitForJobState(database, 'email.send', jobId, ['completed']);
}

function emailRequests() {
  return provider.requests.filter((request) => request.path === RESEND_PATH);
}

function tokenFrom(body: unknown): string {
  const text = (body as { text: string }).text;
  const match = /#token=([A-Za-z0-9_-]+)/.exec(text);
  if (!match?.[1]) {
    throw new Error('email carries no token link');
  }
  return match[1];
}

async function tokensOf(userId: string) {
  return database.admin.db.select().from(emailTokens).where(eq(emailTokens.userId, userId));
}

describe('email.send (ADR-0029)', () => {
  it('issues the token in the worker and stores only its hash', async () => {
    const user = await fixtures.user({ verified: false });
    const { jobId, idempotencyKey } = await sendEmail('verify_email', user.id);
    const job = await completed(jobId);
    expect(job.output).toEqual({ outcome: 'sent' });

    const [request] = emailRequests();
    expect(request?.authorization).toBe(`Bearer ${worker.secrets.resendApiKey}`);
    expect(request?.body).toMatchObject({
      to: [user.email],
      subject: 'Kadro: e-posta adresini doğrula',
    });
    const token = tokenFrom(request?.body);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect((request?.body as { text: string }).text).toContain(
      `http://localhost:3000/e-posta-dogrula#token=${token}`,
    );

    const rows = await tokensOf(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenHash).toBe(sha256Hex(token));
    expect(rows[0]?.purpose).toBe('verify');
    const [row] = rows;
    expect((row?.expiresAt.getTime() ?? 0) - (row?.createdAt.getTime() ?? 0)).toBe(24 * HOUR_MS);

    // The token is nowhere in the job row, the database text of any token row, or the logs.
    const jobRow = (await jobsIn(database, 'email.send')).find((row) => row.id === jobId);
    expect(JSON.stringify(jobRow)).not.toContain(token);
    expect(Object.keys(jobRow?.data ?? {}).sort()).toEqual([
      'idempotencyKey',
      'kind',
      'requestId',
      'userId',
    ]);
    const dump = await database.admin.pool.query<{ row: string }>(
      'select row_to_json(t)::text as row from email_tokens t',
    );
    expect(dump.rows.some((row) => row.row.includes(token))).toBe(false);
    const logText = worker.logs.lines.join('\n');
    expect(logText).not.toContain(token);
    expect(logText).not.toContain(user.email);
    expect(logText).not.toContain(worker.secrets.resendApiKey);

    // Correlation: the completion line carries job id, idempotency key and request id.
    const line = worker.logs
      .entries()
      .find((entry) => entry.jobId === jobId && entry.msg === 'job completed');
    expect(line).toMatchObject({ queue: 'email.send', idempotencyKey, outcome: 'sent' });
    expect(line?.requestId).toEqual(expect.stringMatching(/^req_/));
  });

  it('applies one effect for the same idempotency key, however often it is enqueued', async () => {
    const user = await fixtures.user({ verified: false });
    const idempotencyKey = `email:verify:${user.id}:${newId()}`;
    const first = await sendEmail('verify_email', user.id, idempotencyKey);
    // While the first job is queued or active, pg-boss drops the duplicate.
    const duplicate = await enqueue(worker.runtime.boss, 'email.send', {
      kind: 'verify_email',
      userId: user.id,
      requestId: requestId(),
      idempotencyKey,
    });
    expect(duplicate).toBeNull();
    await completed(first.jobId);

    // After completion a re-send of the same key (operator redrive) is a no-op.
    const again = await sendEmail('verify_email', user.id, idempotencyKey);
    const job = await completed(again.jobId);
    expect(job.output).toEqual({ outcome: 'duplicate' });
    expect(emailRequests()).toHaveLength(1);
    expect(await tokensOf(user.id)).toHaveLength(1);
    const receipts = await database.admin.db
      .select()
      .from(jobReceipts)
      .where(eq(jobReceipts.idempotencyKey, idempotencyKey));
    expect(receipts).toHaveLength(1);
  });

  it('keeps at most three live tokens per user and purpose', async () => {
    const user = await fixtures.user();
    for (let index = 0; index < 5; index += 1) {
      const { jobId } = await sendEmail('password_reset', user.id);
      await completed(jobId);
    }
    expect(emailRequests()).toHaveLength(5);
    const rows = await tokensOf(user.id);
    expect(rows).toHaveLength(5);
    const live = await database.admin.db
      .select()
      .from(emailTokens)
      .where(
        and(
          eq(emailTokens.userId, user.id),
          isNull(emailTokens.usedAt),
          gt(emailTokens.expiresAt, new Date()),
        ),
      );
    expect(live).toHaveLength(3);
    // The newest three stay live: the last email's link still works.
    const lastToken = tokenFrom(emailRequests().at(-1)?.body);
    expect(live.map((row) => row.tokenHash)).toContain(sha256Hex(lastToken));
    expect(rows.every((row) => row.purpose === 'reset')).toBe(true);
  });

  it('runs a forgot-password job without an account through the same path without sending', async () => {
    const { jobId, idempotencyKey } = await sendEmail('password_reset', null);
    const job = await completed(jobId);
    expect(job.output).toEqual({ outcome: 'no_account' });
    expect(emailRequests()).toHaveLength(0);
    const receipts = await database.admin.db
      .select()
      .from(jobReceipts)
      .where(eq(jobReceipts.idempotencyKey, idempotencyKey));
    expect(receipts).toHaveLength(1);
  });

  it('sends nothing when the email is no longer due', async () => {
    const verified = await fixtures.user({ verified: true });
    const social = await fixtures.user({ passwordHash: null });
    const deactivated = await fixtures.user({ deactivatedAt: new Date() });
    const cases = [
      await sendEmail('verify_email', verified.id),
      await sendEmail('password_reset', social.id),
      await sendEmail('password_reset', deactivated.id),
      await sendEmail('deletion_scheduled', verified.id),
      await sendEmail('already_registered', newId()),
    ];
    for (const { jobId } of cases) {
      expect((await completed(jobId)).output).toEqual({ outcome: 'not_due' });
    }
    expect(emailRequests()).toHaveLength(0);
    expect(await tokensOf(social.id)).toHaveLength(0);
  });

  it('sends the deletion notice with the end of the grace period', async () => {
    const user = await fixtures.user({ deactivatedAt: new Date() });
    await database.admin.db.insert(deletionRequests).values({
      userId: user.id,
      graceUntil: new Date('2031-03-10T18:30:00.000Z'),
      requestedAt: new Date('2031-03-03T18:30:00.000Z'),
    });
    const { jobId } = await sendEmail('deletion_scheduled', user.id);
    expect((await completed(jobId)).output).toEqual({ outcome: 'sent' });
    const text = (emailRequests()[0]?.body as { text: string }).text;
    expect(text).toContain('10 Mart 2031 21:30');
    expect(text).not.toContain('#token=');
  });

  it('drops a token email whose job is older than the token lifetime', async () => {
    const user = await fixtures.user();
    clock.advance(HOUR_MS + 60_000);
    const { jobId } = await sendEmail('password_reset', user.id);
    expect((await completed(jobId)).output).toEqual({ outcome: 'stale_dropped' });
    expect(emailRequests()).toHaveLength(0);
    expect(worker.metrics.count('email_stale_dropped', { kind: 'password_reset' })).toBe(1);
  });

  it('deletes the token and completes when the provider rejects the message for good', async () => {
    provider.responders.set(RESEND_PATH, () => ({ status: 422, body: { message: 'invalid' } }));
    const user = await fixtures.user();
    const { jobId } = await sendEmail('password_reset', user.id);
    const job = await completed(jobId);
    expect(job.output).toEqual({ outcome: 'rejected_by_provider' });
    expect(job.retryCount).toBe(0);
    expect(await tokensOf(user.id)).toHaveLength(0);
    expect(worker.metrics.count('email_delivery_failed', { status: 422 })).toBe(1);
  });

  it('retries a 5xx answer and leaves only the token of the delivered attempt', async () => {
    let calls = 0;
    provider.responders.set(RESEND_PATH, () => {
      calls += 1;
      return calls === 1 ? { status: 503 } : { status: 200, body: { id: newId() } };
    });
    const user = await fixtures.user();
    const { jobId } = await sendEmail('password_reset', user.id);
    const job = await completed(jobId);
    expect(job.retryCount).toBe(1);
    expect(job.output).toEqual({ outcome: 'sent' });
    const rows = await tokensOf(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenHash).toBe(sha256Hex(tokenFrom(emailRequests()[1]?.body)));
  });

  it('keeps the token of an attempt with an unknown outcome and retries', async () => {
    let calls = 0;
    provider.responders.set(RESEND_PATH, () => {
      calls += 1;
      return calls === 1 ? { status: 200, destroy: true } : { status: 200, body: { id: newId() } };
    });
    const user = await fixtures.user();
    const { jobId } = await sendEmail('password_reset', user.id);
    const job = await completed(jobId);
    expect(job.retryCount).toBe(1);
    const rows = await tokensOf(user.id);
    expect(rows).toHaveLength(2);
    expect(worker.metrics.count('email_delivery_failed', { reason: 'network' })).toBe(1);
  });

  it('moves a job that exhausted its retries to email.send.dead', async () => {
    provider.responders.set(RESEND_PATH, () => ({ status: 503 }));
    const user = await fixtures.user();
    const { jobId, idempotencyKey } = await sendEmail('password_reset', user.id);
    const failed = await waitForJobState(database, 'email.send', jobId, ['failed'], 30_000);
    expect(failed.retryCount).toBe(2);
    const dead = await waitFor(async () =>
      (await jobsIn(database, 'email.send.dead')).find(
        (row) => row.data.idempotencyKey === idempotencyKey,
      ),
    );
    expect(dead.data).toEqual(failed.data);
    expect(worker.metrics.count('job_dead_lettered', { queue: 'email.send' })).toBe(1);
    expect(await tokensOf(user.id)).toHaveLength(0);
    expect(emailRequests()).toHaveLength(3);
  });

  it('dead-letters a harmful or invalid payload without running the handler', async () => {
    const user = await fixtures.user({ verified: false });
    const smuggled = randomBytes(24).toString('base64url');
    const payloads: Record<string, unknown>[] = [
      // Unknown key carrying a token-looking value (contracts are strict).
      {
        kind: 'verify_email',
        userId: user.id,
        requestId: 'req_x',
        idempotencyKey: `bad:${newId()}`,
        token: smuggled,
      },
      // Kind that never travels through this queue.
      {
        kind: 'deletion_completed',
        userId: user.id,
        requestId: 'req_x',
        idempotencyKey: `bad:${newId()}`,
      },
      // Personal data instead of an id.
      {
        kind: 'verify_email',
        userId: `${smuggled}@example.test`,
        requestId: 'req_x',
        idempotencyKey: `bad:${newId()}`,
      },
      // Oversized key.
      {
        kind: 'verify_email',
        userId: user.id,
        requestId: 'req_x',
        idempotencyKey: 'k'.repeat(4_000),
      },
      // Prototype pollution attempt.
      JSON.parse(
        `{"kind":"verify_email","userId":"${user.id}","requestId":"req_x","idempotencyKey":"bad:${newId()}","__proto__":{"polluted":"${smuggled}"}}`,
      ) as Record<string, unknown>,
    ];
    const ids: string[] = [];
    for (const [index, data] of payloads.entries()) {
      const id = await worker.runtime.boss.send('email.send', data, {
        singletonKey: `harmful-${index}-${newId()}`,
      });
      ids.push(id ?? '');
    }
    for (const id of ids) {
      const job = await waitForJobState(database, 'email.send', id, ['failed']);
      expect(job.retryCount).toBe(0);
      expect(job.output).toEqual({ outcome: 'invalid_payload' });
    }
    const dead = await jobsIn(database, 'email.send.dead');
    expect(dead.filter((row) => row.data.requestId === 'req_x')).toHaveLength(payloads.length);
    expect(emailRequests()).toHaveLength(0);
    expect(await tokensOf(user.id)).toHaveLength(0);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(worker.logs.lines.join('\n')).not.toContain(smuggled);
    expect(worker.metrics.count('job_dead_lettered', { reason: 'invalid_payload' })).toBe(
      payloads.length,
    );
  });

  it('refuses the producer-side enqueue of a payload that breaks the contract', async () => {
    await expect(
      enqueue(worker.runtime.boss, 'email.send', {
        kind: 'verify_email',
        userId: null,
        requestId: requestId(),
        idempotencyKey: `email:${newId()}`,
      }),
    ).rejects.toThrow();
  });
});

describe('email transport factory', () => {
  it('refuses the log transport outside APP_ENV=local', () => {
    const logger = createLogger({ level: 'silent', buildSha: 'test', appEnv: 'production' });
    expect(() =>
      createEmailTransport(
        {
          APP_ENV: 'production',
          EMAIL_TRANSPORT: 'log',
          EMAIL_FROM: 'Kadro <bildirim@kadro.app>',
        },
        { logger, fetch: globalThis.fetch },
      ),
    ).toThrow(/APP_ENV=local/);
  });

  it('never stores a plaintext token: the database rejects a non-hash value', async () => {
    const user = await fixtures.user();
    await expect(
      database.admin.db.insert(emailTokens).values({
        userId: user.id,
        purpose: 'reset',
        tokenHash: randomBytes(32).toString('base64url').slice(0, 64).padEnd(64, 'Z'),
        expiresAt: new Date(Date.now() + HOUR_MS),
      }),
    ).rejects.toThrow();
    const [row] = await database.admin.db.select().from(users).where(eq(users.id, user.id));
    expect(row?.id).toBe(user.id);
  });
});
