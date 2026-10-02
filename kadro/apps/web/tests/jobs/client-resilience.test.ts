import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createSendOnlyClient } from '../../lib/server/jobs/client';
import { safeLog } from '../../lib/server/safe-log';
import { type JobsHarness, setupJobsHarness } from './support';

let jobs: JobsHarness;

beforeAll(async () => {
  jobs = await setupJobsHarness('web_jobs_resilience');
});

afterAll(async () => {
  await jobs.dispose();
});

describe('send-only job client', () => {
  it('survives a logger that throws inside the error listener', async () => {
    let attempts = 0;
    const logger = {
      error: () => {
        attempts += 1;
        throw new Error('log transport down');
      },
    } as never;
    const client = createSendOnlyClient({ connectionString: jobs.logins.appUrl, logger });
    try {
      const boss = await client.boss();
      expect(() => boss.emit('error', new Error('boss failure'))).not.toThrow();
      expect(attempts).toBe(1);
    } finally {
      await client.close();
    }
  });
});

describe('safeLog', () => {
  it('swallows a throwing log call and returns normally', () => {
    expect(() =>
      safeLog(() => {
        throw new Error('log transport down');
      }),
    ).not.toThrow();
  });
});
