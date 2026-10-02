import { loginRequestSchema } from '@kadro/contracts';
import { DrizzleQueryError } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ApiError } from '../lib/server/errors';
import { json, route } from '../lib/server/http';
import {
  createLogger,
  maskEmail,
  maskEmailsInText,
  REDACT_PATHS,
  serializeError,
} from '../lib/server/logging';
import { noParams } from '../lib/server/validate';
import { call, MOBILE, WEB } from './support/http';
import { installTestRuntime, type TestRuntime } from './support/runtime';

const EMAIL = 'ayberk.test@example.test';
const PASSWORD = `Pw-${'A'.repeat(14)}`;
const REFRESH = 'R'.repeat(43);

function capture(level: 'info' | 'debug' = 'info') {
  const lines: string[] = [];
  const logger = createLogger({
    level,
    destination: {
      write(line: string) {
        lines.push(line);
      },
    },
  });
  return { logger, lines };
}

describe('maskEmail', () => {
  it('keeps only the first character of local part and domain', () => {
    expect(maskEmail('ayberk@domain.com')).toBe('a***@d***');
    expect(maskEmail('A@b')).toBe('A***@b***');
  });

  it('hides values that are not addresses', () => {
    expect(maskEmail('no-at-sign')).toBe('***');
    expect(maskEmail('@domain')).toBe('***');
    expect(maskEmail('user@')).toBe('***');
    expect(maskEmail(42)).toBe('[Redacted]');
    expect(maskEmail(null)).toBe('[Redacted]');
  });

  it('masks addresses inside free text', () => {
    expect(maskEmailsInText(`duplicate key for ${EMAIL} and x@y.z`)).toBe(
      'duplicate key for a***@e*** and x***@y***',
    );
  });
});

describe('pino redaction (security checklist item 14)', () => {
  it('redacts credentials in request and response headers', () => {
    const { logger, lines } = capture();
    logger.info(
      {
        req: {
          headers: {
            authorization: `Bearer ${REFRESH}`,
            cookie: `__Host-kadro_session=${REFRESH}`,
            'x-csrf-token': REFRESH,
            'user-agent': 'Kadro/1.0',
          },
        },
        res: { headers: { 'set-cookie': `__Host-kadro_session=${REFRESH}` } },
      },
      'headers',
    );
    const record = JSON.parse(lines[0] ?? '{}') as {
      req: { headers: Record<string, string> };
      res: { headers: Record<string, string> };
    };
    expect(record.req.headers.authorization).toBe('[Redacted]');
    expect(record.req.headers.cookie).toBe('[Redacted]');
    expect(record.req.headers['x-csrf-token']).toBe('[Redacted]');
    expect(record.req.headers['user-agent']).toBe('Kadro/1.0');
    expect(record.res.headers['set-cookie']).toBe('[Redacted]');
    expect(lines[0]).not.toContain(REFRESH);
  });

  it('redacts secrets and masks emails up to three levels deep', () => {
    const { logger, lines } = capture();
    logger.info(
      {
        password: PASSWORD,
        email: EMAIL,
        attempt: { password: PASSWORD, email: EMAIL, refreshToken: REFRESH, token: REFRESH },
        user: { profile: { email: EMAIL, accessToken: REFRESH, idToken: REFRESH } },
      },
      'nested',
    );
    const line = lines[0] ?? '';
    expect(line).not.toContain(PASSWORD);
    expect(line).not.toContain(EMAIL);
    expect(line).not.toContain(REFRESH);
    const record = JSON.parse(line) as {
      email: string;
      attempt: { email: string; password: string };
      user: { profile: { email: string } };
    };
    expect(record.email).toBe('a***@e***');
    expect(record.attempt.email).toBe('a***@e***');
    expect(record.attempt.password).toBe('[Redacted]');
    expect(record.user.profile.email).toBe('a***@e***');
  });

  it('covers every documented field', () => {
    for (const path of [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.token',
      '*.refreshToken',
      '*.email',
    ]) {
      expect(REDACT_PATHS).toContain(path);
    }
  });
});

describe('serializeError', () => {
  it('drops SQL text, bound parameters and driver messages of database errors', () => {
    const cause = Object.assign(new Error(`Key (email)=(${EMAIL}) already exists`), {
      code: '23505',
      severity: 'ERROR',
      constraint: 'users_email_lower_key',
    });
    const error = new DrizzleQueryError(
      'insert into "users" ("email") values ($1)',
      [EMAIL],
      cause,
    );
    const text = JSON.stringify(serializeError(error));
    expect(text).not.toContain(EMAIL);
    expect(text).not.toContain('insert into');
    expect(serializeError(error)).toEqual({
      type: 'DrizzleQueryError',
      cause: { type: 'Error', sqlState: '23505', constraint: 'users_email_lower_key' },
    });
  });

  it('drops the message of a query error whose cause is not a database error', () => {
    const error = new DrizzleQueryError('select 1 where $1', [EMAIL], new Error('ECONNREFUSED'));
    const serialized = serializeError(error);
    expect(JSON.stringify(serialized)).not.toContain(EMAIL);
    expect(serialized.type).toBe('DrizzleQueryError');
    expect(serialized.cause?.message).toBe('ECONNREFUSED');
  });

  it('keeps message and stack of other errors with emails masked', () => {
    const serialized = serializeError(new Error(`mail to ${EMAIL} bounced`));
    expect(serialized.message).toBe('mail to a***@e*** bounced');
    expect(serialized.stack).not.toContain(EMAIL);
  });
});

describe('request logging through the route wrapper', () => {
  let harness: TestRuntime;

  beforeAll(async () => {
    harness = await installTestRuntime();
  });

  beforeEach(() => {
    harness.logLines.length = 0;
  });

  /** A careless handler that logs the credentials it received, then fails like a bad login. */
  const login = route({
    path: '/api/v1/test/login',
    method: 'POST',
    auth: 'none',
    params: noParams,
    query: z.strictObject({ ignored: z.string().optional() }),
    body: loginRequestSchema,
    handler: ({ body, ctx }) => {
      ctx.logger.info({ email: body.email, password: body.password }, 'login attempt');
      if (![PASSWORD].includes(body.password)) {
        throw new ApiError('invalid_credentials');
      }
      return json({ tokens: { refreshToken: REFRESH } });
    },
  });

  async function loginFlow(password: string, headers: Record<string, string> = MOBILE) {
    return call(login, {
      method: 'POST',
      path: '/api/v1/test/login?ignored=1',
      headers: { ...headers, authorization: `Bearer ${REFRESH}`, cookie: `a=${REFRESH}` },
      json: { email: EMAIL, password },
    });
  }

  it('produces a login log sample without email, password or token', async () => {
    await loginFlow(PASSWORD);
    await loginFlow(`${PASSWORD}-wrong`);
    const sample = harness.logLines.join('\n');
    expect(harness.logLines.length).toBeGreaterThanOrEqual(4);
    expect(sample).not.toContain(EMAIL);
    expect(sample).not.toContain(PASSWORD);
    expect(sample).not.toContain(REFRESH);
    expect(sample).toContain('a***@e***');
  });

  it('writes one request line with route pattern, status and no body at info', async () => {
    const response = await loginFlow(`${PASSWORD}-wrong`, WEB);
    const requestId = response.headers.get('x-request-id');
    const records = harness.logLines.map((line) => JSON.parse(line) as Record<string, unknown>);
    const completed = records.filter((record) => record.msg === 'request completed');
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({
      level: 30,
      requestId,
      route: '/api/v1/test/login',
      method: 'POST',
      status: 401,
      client: 'web',
      problemCode: 'invalid_credentials',
    });
    for (const record of records) {
      expect(record).not.toHaveProperty('body');
      expect(record).not.toHaveProperty('url');
      expect(JSON.stringify(record)).not.toContain('ignored=1');
    }
  });

  it('attaches the response request id to every line of the request', async () => {
    const response = await loginFlow(PASSWORD);
    const requestId = response.headers.get('x-request-id');
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    const records = harness.logLines.map((line) => JSON.parse(line) as { requestId?: string });
    // handler line, request line and the ADR-0022 missing-IP warning (no proxy header here)
    expect(records.length).toBe(3);
    expect(records.every((record) => record.requestId === requestId)).toBe(true);
  });

  it('propagates the id assigned by the proxy', async () => {
    const assigned = '6f1d2c3b-4a59-4e1f-8a2b-3c4d5e6f7a8b';
    const response = await call(login, {
      method: 'POST',
      headers: { ...MOBILE, 'x-request-id': assigned },
      json: { email: EMAIL, password: PASSWORD },
    });
    expect(response.headers.get('x-request-id')).toBe(assigned);
    expect(harness.logLines.every((line) => line.includes(assigned))).toBe(true);
  });

  it('replaces a malformed incoming id', async () => {
    const response = await call(login, {
      method: 'POST',
      headers: { ...MOBILE, 'x-request-id': 'forged-request-id level=60' },
      json: { email: EMAIL, password: PASSWORD },
    });
    expect(response.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });
});
