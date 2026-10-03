import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { POST as webhook } from '../../app/api/v1/webhooks/revenuecat/route';
import { createMigratedDatabase, type TestDatabase } from '../support/db';
import { bootstrapJobQueues } from '../support/jobs';
import { call, expectProblem } from '../support/http';
import { installTestRuntime, type TestRuntime } from '../support/runtime';

/**
 * RevenueCat webhook forgery (threat model T-SUB-01, checklist item 17). The delivery is
 * authenticated only by the shared secret in `Authorization`, compared constant-time before the
 * body is read (ADR-0063). A forged or absent secret must be rejected with 401 and the event body
 * must never be processed. Replay / duplicate-event handling is exercised end-to-end by
 * `tests/billing/webhook.test.ts`; this suite is the adversarial signature probe.
 */

// A 43-char (256-bit) base64url-shaped value built from plain words at run time: obviously fake,
// zero entropy, never a real secret (config requires >= 43 base64url characters).
const SECRET = 'not-a-real-webhook-secret'.padEnd(43, 'x');
let database: TestDatabase;
let harness: TestRuntime;

beforeAll(async () => {
  database = await createMigratedDatabase('web_attack_webhook');
  await bootstrapJobQueues(database.url);
  harness = await installTestRuntime({
    db: database.client.db,
    env: { DATABASE_URL: database.url, REVENUECAT_WEBHOOK_SECRET: SECRET },
  });
});

afterAll(async () => {
  await harness.runtime.jobClient.close();
  await database.dispose();
});

function deliver(authorization: string | null): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (authorization !== null) {
    headers.authorization = authorization;
  }
  return call(webhook, {
    method: 'POST',
    headers,
    path: '/api/v1/webhooks/revenuecat',
    json: { event: { type: 'INITIAL_PURCHASE', id: 'evt-forged-1', app_user_id: 'nobody' } },
  });
}

describe('forged RevenueCat deliveries', () => {
  it('rejects a delivery with no Authorization header', async () => {
    await expectProblem(await deliver(null), 401, 'unauthenticated');
  });

  it('rejects a wrong secret and an empty secret', async () => {
    await expectProblem(await deliver('totally-wrong-secret'), 401, 'unauthenticated');
    await expectProblem(await deliver('Bearer totally-wrong-secret'), 401, 'unauthenticated');
    await expectProblem(await deliver(''), 401, 'unauthenticated');
  });

  it('accepts the secret gate but then validates the body (no 401 past the gate)', async () => {
    // With the correct secret the signature check passes; a bogus envelope now fails validation,
    // proving the secret is the only control bypassed and the body is still checked.
    const response = await deliver(SECRET);
    expect(response.status).not.toBe(401);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });
});
