import { issueEmailToken } from '@kadro/auth';
import { emailSendJobSchema } from '@kadro/contracts';
import { emailTokens, users } from '@kadro/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { POST as forgot } from '../../app/api/v1/auth/forgot/route';
import { POST as register } from '../../app/api/v1/auth/register/route';
import { POST as verifyEmail } from '../../app/api/v1/auth/verify-email/route';
import { type JobSender } from '../../lib/server/jobs/enqueue';
import {
  type AuthHarness,
  createUser,
  mobile,
  newPassword,
  post,
  setupAuthHarness,
  uniqueEmail,
} from '../auth/support';
import { expectProblem } from '../support/http';
import { type StoredJob, storedJobs } from '../support/jobs';

/**
 * ADR-0029 email path: register and forgot enqueue exactly one `email.send` job inside their
 * transaction, payloads carry ids only, no token is created by the web process, and the job keys
 * follow handoff worker-to-web-001 §2.
 */

let auth: AuthHarness;

beforeAll(async () => {
  auth = await setupAuthHarness('web_jobs_email', { RATE_LIMIT_AUTH_MAX: '100' });
});

afterAll(async () => {
  await auth.database.dispose();
});

beforeEach(async () => {
  // Deliver what earlier tests enqueued, so each test sees only its own emails.
  await auth.drain();
  auth.mail.sent.length = 0;
  auth.breach = { status: 'clean' };
});

async function newJobs(
  run: () => Promise<Response>,
): Promise<{ response: Response; jobs: StoredJob[] }> {
  const before = new Set((await storedJobs(auth.database.url, 'email.send')).map((job) => job.id));
  const response = await run();
  const jobs = (await storedJobs(auth.database.url, 'email.send')).filter(
    (job) => !before.has(job.id),
  );
  return { response, jobs };
}

async function tokenCount(userId: string): Promise<number> {
  const rows = await auth.database.client.db
    .select({ id: emailTokens.id })
    .from(emailTokens)
    .where(eq(emailTokens.userId, userId));
  return rows.length;
}

describe('register', () => {
  it('enqueues verify_email for a new account, with ids only and no web-side token', async () => {
    const email = uniqueEmail();
    const { response, jobs } = await newJobs(() =>
      post(register, mobile(), { email, password: newPassword(), displayName: 'Yeni Oyuncu' }),
    );
    expect(response.status).toBe(202);
    const requestId = response.headers.get('x-request-id') ?? '';
    const [user] = await auth.database.client.db.select().from(users).where(eq(users.email, email));
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.data).toEqual({
      kind: 'verify_email',
      userId: user?.id,
      requestId,
      idempotencyKey: `email:verify:${user?.id ?? ''}:${requestId}`,
    });
    expect(emailSendJobSchema.safeParse(jobs[0]?.data).success).toBe(true);
    expect(JSON.stringify(jobs[0]?.data)).not.toContain(email);
    expect(await tokenCount(user?.id ?? '')).toBe(0);
  });

  it('enqueues already_registered for an existing account and changes nothing', async () => {
    const existing = await createUser(auth);
    const { response, jobs } = await newJobs(() =>
      post(register, mobile(), {
        email: existing.email.toUpperCase(),
        password: newPassword(),
        displayName: 'Baska Ad',
      }),
    );
    expect(response.status).toBe(202);
    const requestId = response.headers.get('x-request-id') ?? '';
    expect(jobs.map((job) => job.data)).toEqual([
      {
        kind: 'already_registered',
        userId: existing.id,
        requestId,
        idempotencyKey: `email:registered:${existing.id}:${requestId}`,
      },
    ]);
  });

  it('rolls the account back when the job cannot be enqueued', async () => {
    const jobs = auth.harness.runtime.jobs as { enqueue: JobSender['enqueue'] };
    const original = jobs.enqueue;
    jobs.enqueue = () => Promise.reject(new Error('queue unavailable'));
    const email = uniqueEmail();
    try {
      const response = await post(register, mobile(), {
        email,
        password: newPassword(),
        displayName: 'Kayip Oyuncu',
      });
      await expectProblem(response, 500, 'internal_error');
    } finally {
      jobs.enqueue = original;
    }
    expect(
      await auth.database.client.db.select().from(users).where(eq(users.email, email)),
    ).toEqual([]);
  });
});

describe('forgot', () => {
  it('enqueues exactly one job per call; userId only for an account that can reset', async () => {
    const withPassword = await createUser(auth);
    const socialOnly = await createUser(auth, { passwordHash: null, googleSub: `g-${Date.now()}` });
    const deactivated = await createUser(auth, { deactivatedAt: new Date() });
    const unknown = uniqueEmail();
    const cases = [
      [withPassword.email, withPassword.id],
      [unknown, null],
      [socialOnly.email, null],
      [deactivated.email, null],
    ] as const;
    for (const [email, userId] of cases) {
      const { response, jobs } = await newJobs(() => post(forgot, mobile(), { email }));
      expect(response.status).toBe(202);
      const requestId = response.headers.get('x-request-id') ?? '';
      expect(
        jobs.map((job) => job.data),
        email,
      ).toEqual([
        {
          kind: 'password_reset',
          userId,
          requestId,
          idempotencyKey: `email:reset:${userId ?? 'none'}:${requestId}`,
        },
      ]);
      expect(JSON.stringify(jobs[0]?.data)).not.toContain(email);
    }
    expect(await tokenCount(withPassword.id)).toBe(0);
    await auth.drain();
    expect(auth.mail.sent.map((message) => [message.to, message.kind])).toEqual([
      [withPassword.email, 'password_reset'],
    ]);
  });
});

describe('verify-email (ADR-0029 single use per purpose)', () => {
  it('spends every other open verification token of the user', async () => {
    const user = await createUser(auth, { emailVerifiedAt: null });
    const tokens: string[] = [];
    for (let index = 0; index < 2; index += 1) {
      const issued = issueEmailToken('verify', auth.harness.runtime.now());
      await auth.database.client.db.insert(emailTokens).values({ userId: user.id, ...issued.row });
      tokens.push(issued.token);
    }
    expect((await post(verifyEmail, mobile(), { token: tokens[1] })).status).toBe(204);
    const open = await auth.database.client.db
      .select({ usedAt: emailTokens.usedAt })
      .from(emailTokens)
      .where(eq(emailTokens.userId, user.id));
    expect(open.every((row) => row.usedAt !== null)).toBe(true);
    await expectProblem(
      await post(verifyEmail, mobile(), { token: tokens[0] }),
      401,
      'token_invalid',
    );
  });
});
