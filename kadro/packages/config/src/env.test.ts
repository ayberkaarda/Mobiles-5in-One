import { generateKeyPairSync, randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  EnvValidationError,
  loadDatabaseEnv,
  parseDatabaseEnv,
  parseWebEnv,
  parseWorkerEnv,
} from './index.js';
import { parseMobilePublicEnv } from './mobile.js';

const validWorker = {
  NODE_ENV: 'development',
  APP_ENV: 'local',
  BUILD_SHA: 'local',
  LOG_LEVEL: 'info',
  DATABASE_URL: 'postgres://kadro:kadro@localhost:5432/kadro',
  WEB_ORIGIN: 'http://localhost:3000',
  EMAIL_TRANSPORT: 'log',
  EMAIL_FROM: 'Kadro <bildirim@kadro.app>',
  PUSH_TRANSPORT: 'log',
  R2_ENDPOINT: 'http://localhost:9000',
  R2_ACCESS_KEY_ID: 'kadro-local',
  R2_SECRET_ACCESS_KEY: 'kadro-local-storage',
  R2_INCOMING_BUCKET: 'kadro-uploads-incoming',
  R2_MEDIA_BUCKET: 'kadro-media',
};

/** Worker settings of a preview or production deployment; credentials are generated per run. */
function deployedWorker(): Record<string, string> {
  return {
    ...validWorker,
    NODE_ENV: 'production',
    APP_ENV: 'production',
    WEB_ORIGIN: 'https://kadro.app',
    EMAIL_TRANSPORT: 'resend',
    RESEND_API_KEY: `re_${randomBytes(18).toString('base64url')}`,
    PUSH_TRANSPORT: 'expo',
    EXPO_ACCESS_TOKEN: randomBytes(30).toString('base64url'),
    R2_ENDPOINT: 'https://example-account.r2.cloudflarestorage.com',
    R2_ACCESS_KEY_ID: randomBytes(16).toString('hex'),
    R2_SECRET_ACCESS_KEY: randomBytes(32).toString('hex'),
  };
}

function captureError(fn: () => unknown): EnvValidationError {
  try {
    fn();
  } catch (error) {
    if (error instanceof EnvValidationError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected EnvValidationError');
}

describe('parseWorkerEnv', () => {
  it('accepts the documented local values', () => {
    expect(parseWorkerEnv(validWorker)).toEqual({
      ...validWorker,
      PUSH_HOURLY_CAP: 5_000,
      EMAIL_DAILY_CAP: 2_000,
      EMAIL_MONTHLY_CAP: 45_000,
      PUSH_DAILY_CAP: 50_000,
      REVENUECAT_API_BASE_URL: 'https://api.revenuecat.com',
    });
  });

  it('keeps the RevenueCat REST key optional and validates it without echoing it', () => {
    expect(parseWorkerEnv(deployedWorker()).REVENUECAT_API_KEY).toBeUndefined();
    const key = ['s', 'k_', randomBytes(16).toString('hex')].join('');
    expect(
      parseWorkerEnv({ ...deployedWorker(), REVENUECAT_API_KEY: key }).REVENUECAT_API_KEY,
    ).toBe(key);
    const bad = `pk_${randomBytes(16).toString('hex')}`;
    const error = captureError(() => parseWorkerEnv({ ...validWorker, REVENUECAT_API_KEY: bad }));
    expect(error.issues.map((issue) => issue.key)).toEqual(['REVENUECAT_API_KEY']);
    expect(error.message).not.toContain(bad);
  });

  it('allows a loopback RevenueCat fake server only locally', () => {
    expect(
      parseWorkerEnv({ ...validWorker, REVENUECAT_API_BASE_URL: 'http://localhost:4010' })
        .REVENUECAT_API_BASE_URL,
    ).toBe('http://localhost:4010');
    const error = captureError(() =>
      parseWorkerEnv({ ...deployedWorker(), REVENUECAT_API_BASE_URL: 'http://localhost:4010' }),
    );
    expect(error.issues.map((issue) => issue.key)).toEqual(['REVENUECAT_API_BASE_URL']);
    expect(
      captureError(() =>
        parseWorkerEnv({ ...validWorker, REVENUECAT_API_BASE_URL: 'https://api.example/v1' }),
      ).issues.map((issue) => issue.key),
    ).toEqual(['REVENUECAT_API_BASE_URL']);
  });

  it('defaults the transports to log and the push cap to 5 000', () => {
    const { EMAIL_TRANSPORT: _email, PUSH_TRANSPORT: _push, ...rest } = validWorker;
    const parsed = parseWorkerEnv(rest);
    expect(parsed.EMAIL_TRANSPORT).toBe('log');
    expect(parsed.PUSH_TRANSPORT).toBe('log');
    expect(parsed.PUSH_HOURLY_CAP).toBe(5_000);
  });

  it('accepts a complete deployed configuration', () => {
    const source = deployedWorker();
    const parsed = parseWorkerEnv(source);
    expect(parsed.EMAIL_TRANSPORT).toBe('resend');
    expect(parsed.PUSH_TRANSPORT).toBe('expo');
    expect(parsed.EXPO_ACCESS_TOKEN).toBe(source.EXPO_ACCESS_TOKEN);
  });

  it('refuses the log transports outside local', () => {
    const error = captureError(() =>
      parseWorkerEnv({ ...deployedWorker(), EMAIL_TRANSPORT: 'log', PUSH_TRANSPORT: 'log' }),
    );
    expect(error.issues.map((issue) => issue.key).sort()).toEqual([
      'EMAIL_TRANSPORT',
      'PUSH_TRANSPORT',
    ]);
  });

  it('requires the provider credential of each remote transport without echoing it', () => {
    const { RESEND_API_KEY: _resend, EXPO_ACCESS_TOKEN: _expo, ...rest } = deployedWorker();
    const error = captureError(() => parseWorkerEnv(rest));
    expect(error.issues.map((issue) => issue.key).sort()).toEqual([
      'EXPO_ACCESS_TOKEN',
      'RESEND_API_KEY',
    ]);

    const malformed = `bad token ${randomBytes(8).toString('hex')}`;
    const invalid = captureError(() =>
      parseWorkerEnv({ ...deployedWorker(), EXPO_ACCESS_TOKEN: malformed }),
    );
    expect(invalid.issues.map((issue) => issue.key)).toEqual(['EXPO_ACCESS_TOKEN']);
    expect(invalid.message).not.toContain(malformed);
  });

  it('requires a non-loopback https web origin outside local', () => {
    for (const value of ['http://kadro.app', 'https://localhost:3000']) {
      const error = captureError(() => parseWorkerEnv({ ...deployedWorker(), WEB_ORIGIN: value }));
      expect(error.issues.map((issue) => issue.key)).toEqual(['WEB_ORIGIN']);
    }
  });

  it('requires the object storage settings of the worker', () => {
    const {
      R2_ENDPOINT: _endpoint,
      R2_ACCESS_KEY_ID: _id,
      R2_SECRET_ACCESS_KEY: _secret,
      R2_INCOMING_BUCKET: _incoming,
      R2_MEDIA_BUCKET: _media,
      ...rest
    } = validWorker;
    const error = captureError(() => parseWorkerEnv(rest));
    expect(error.issues.map((issue) => issue.key).sort()).toEqual([
      'R2_ACCESS_KEY_ID',
      'R2_ENDPOINT',
      'R2_INCOMING_BUCKET',
      'R2_MEDIA_BUCKET',
      'R2_SECRET_ACCESS_KEY',
    ]);
    expect(error.issues.every((issue) => issue.message === 'is required')).toBe(true);
  });

  it('requires a non-loopback https storage endpoint outside local and no credentials in it', () => {
    for (const value of ['http://storage.example', 'https://127.0.0.1:9000']) {
      const error = captureError(() => parseWorkerEnv({ ...deployedWorker(), R2_ENDPOINT: value }));
      expect(error.issues.map((issue) => issue.key)).toEqual(['R2_ENDPOINT']);
    }
    const withPath = captureError(() =>
      parseWorkerEnv({ ...validWorker, R2_ENDPOINT: 'http://user:pw@localhost:9000/bucket' }),
    );
    expect(withPath.issues.map((issue) => issue.key)).toEqual(['R2_ENDPOINT']);
    expect(withPath.message).not.toContain('pw@');
  });

  it('rejects invalid bucket names, identical buckets and a malformed secret without echoing it', () => {
    const bad = captureError(() =>
      parseWorkerEnv({ ...validWorker, R2_INCOMING_BUCKET: 'Kadro_Uploads' }),
    );
    expect(bad.issues.map((issue) => issue.key)).toEqual(['R2_INCOMING_BUCKET']);
    const same = captureError(() =>
      parseWorkerEnv({ ...validWorker, R2_MEDIA_BUCKET: validWorker.R2_INCOMING_BUCKET }),
    );
    expect(same.issues.map((issue) => issue.key)).toEqual(['R2_MEDIA_BUCKET']);
    const secret = `short ${randomBytes(4).toString('hex')}`;
    const malformed = captureError(() =>
      parseWorkerEnv({ ...validWorker, R2_SECRET_ACCESS_KEY: secret }),
    );
    expect(malformed.issues.map((issue) => issue.key)).toEqual(['R2_SECRET_ACCESS_KEY']);
    expect(malformed.message).not.toContain(secret);
  });

  it('bounds the hourly push cap', () => {
    for (const value of ['0', '100001', 'many']) {
      const error = captureError(() => parseWorkerEnv({ ...validWorker, PUSH_HOURLY_CAP: value }));
      expect(error.issues.map((issue) => issue.key)).toEqual(['PUSH_HOURLY_CAP']);
    }
    expect(parseWorkerEnv({ ...validWorker, PUSH_HOURLY_CAP: '250' }).PUSH_HOURLY_CAP).toBe(250);
  });

  it('bounds the usage thresholds of cost.guard and accepts 0 as disabled', () => {
    for (const key of ['EMAIL_DAILY_CAP', 'EMAIL_MONTHLY_CAP', 'PUSH_DAILY_CAP'] as const) {
      for (const value of ['-1', '1.5', 'many', '1000000000']) {
        const error = captureError(() => parseWorkerEnv({ ...validWorker, [key]: value }));
        expect(error.issues.map((issue) => issue.key)).toEqual([key]);
      }
      expect(parseWorkerEnv({ ...validWorker, [key]: '0' })[key]).toBe(0);
      expect(parseWorkerEnv({ ...validWorker, [key]: '120' })[key]).toBe(120);
    }
  });

  it('drops keys that are not part of the schema', () => {
    const parsed = parseWorkerEnv({ ...validWorker, UNRELATED_SECRET: 'x' });
    expect(parsed).not.toHaveProperty('UNRELATED_SECRET');
  });

  it('reports every missing key as required', () => {
    const error = captureError(() => parseWorkerEnv({}));
    expect(error.issues.map((issue) => issue.key).sort()).toEqual(
      [
        'APP_ENV',
        'BUILD_SHA',
        'DATABASE_URL',
        'LOG_LEVEL',
        'NODE_ENV',
        'R2_ACCESS_KEY_ID',
        'R2_ENDPOINT',
        'R2_INCOMING_BUCKET',
        'R2_MEDIA_BUCKET',
        'R2_SECRET_ACCESS_KEY',
        'WEB_ORIGIN',
      ].sort(),
    );
    expect(error.issues.every((issue) => issue.message === 'is required')).toBe(true);
  });

  it('rejects non-postgres database URLs without echoing the value', () => {
    const secretUrl = 'mysql://root:hunter2@db.internal:3306/kadro';
    const error = captureError(() => parseWorkerEnv({ ...validWorker, DATABASE_URL: secretUrl }));
    expect(error.issues).toEqual([
      { key: 'DATABASE_URL', message: 'must be a postgres:// or postgresql:// connection URL' },
    ]);
    expect(error.message).not.toContain('hunter2');
  });

  it('requires NODE_ENV=production outside local', () => {
    const error = captureError(() =>
      parseWorkerEnv({ ...deployedWorker(), NODE_ENV: 'development' }),
    );
    expect(error.issues.map((issue) => issue.key)).toEqual(['NODE_ENV']);
  });
});

interface PemPair {
  privatePem: string;
  publicPem: string;
}

function ecPair(namedCurve: string): PemPair {
  const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { privatePem: privateKey, publicPem: publicKey };
}

function rsaPair(): PemPair {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { privatePem: privateKey, publicPem: publicKey };
}

function es256Pair(): PemPair {
  return ecPair('P-256');
}

const keys = es256Pair();

/** Minimal valid local web configuration: optional keys are left to their defaults. */
const validWeb = {
  NODE_ENV: 'development',
  APP_ENV: 'local',
  BUILD_SHA: 'local',
  LOG_LEVEL: 'info',
  DATABASE_URL: 'postgres://kadro:kadro@localhost:5432/kadro',
  WEB_ORIGIN: 'http://localhost:3000',
  CORS_ALLOWED_ORIGINS: 'http://localhost:3000',
  JWT_PRIVATE_KEY: keys.privatePem,
  JWT_PUBLIC_KEY: keys.publicPem,
  CSRF_SECRET: randomBytes(32).toString('base64url'),
  HASH_SECRET: randomBytes(32).toString('base64url'),
  APPLE_AUDIENCES: 'app.kadro.mobile',
  GOOGLE_CLIENT_IDS: '100000000000-kadrolocaldevelopment.apps.googleusercontent.com',
};

const validProductionWeb = {
  ...validWeb,
  NODE_ENV: 'production',
  APP_ENV: 'production',
  BUILD_SHA: '3f2a9c1',
  WEB_ORIGIN: 'https://kadro.app',
  CORS_ALLOWED_ORIGINS: 'https://kadro.app, https://www.kadro.app',
  EMAIL_TRANSPORT: 'resend',
  RESEND_API_KEY: `re_${'A'.repeat(32)}`,
  R2_ENDPOINT: 'https://example-account.r2.cloudflarestorage.com',
  R2_ACCESS_KEY_ID: randomBytes(16).toString('hex'),
  R2_SECRET_ACCESS_KEY: randomBytes(32).toString('hex'),
  R2_INCOMING_BUCKET: 'kadro-uploads-incoming',
  MEDIA_PUBLIC_BASE_URL: 'https://media.kadro.app',
  REVENUECAT_WEBHOOK_SECRET: randomBytes(32).toString('base64url'),
  TOTP_ENCRYPTION_KEY: randomBytes(32).toString('base64url'),
};

const localWebStorage = {
  R2_ENDPOINT: 'http://localhost:9000',
  R2_ACCESS_KEY_ID: 'kadro-local',
  R2_SECRET_ACCESS_KEY: 'kadro-local-storage',
  R2_INCOMING_BUCKET: 'kadro-uploads-incoming',
};

function webIssueKeys(overrides: Record<string, string | undefined>): string[] {
  try {
    parseWebEnv({ ...validWeb, ...overrides });
  } catch (error) {
    if (error instanceof EnvValidationError) {
      return error.issues.map((issue) => issue.key);
    }
    throw error;
  }
  return [];
}

describe('parseWebEnv', () => {
  it('accepts a local configuration and applies spec defaults', () => {
    const env = parseWebEnv(validWeb);
    expect(env.ACCESS_TOKEN_TTL_SECONDS).toBe(900);
    expect(env.REFRESH_TOKEN_TTL_SECONDS).toBe(2_592_000);
    expect(env.SESSION_TTL_SECONDS).toBe(604_800);
    expect(env.SESSION_COOKIE_NAME).toBe('__Host-kadro_session');
    expect(env.CSRF_COOKIE_NAME).toBe('__Host-kadro_csrf');
    expect(env.CLIENT_IP_HEADER).toBe('x-forwarded-for');
    expect(env.TRUSTED_PROXY_CIDRS).toEqual([]);
    expect(env.RATE_LIMIT_AUTH_MAX).toBe(5);
    expect(env.RATE_LIMIT_AUTH_WINDOW_SECONDS).toBe(900);
    expect(env.RATE_LIMIT_AUTH_DELAY_AFTER_FAILURES).toBe(3);
    expect(env.RATE_LIMIT_REFRESH_MAX).toBe(30);
    expect(env.CORS_ALLOWED_ORIGINS).toEqual(['http://localhost:3000']);
  });

  it('accepts a production configuration and splits lists', () => {
    const env = parseWebEnv(validProductionWeb);
    expect(env.CORS_ALLOWED_ORIGINS).toEqual(['https://kadro.app', 'https://www.kadro.app']);
    expect(env.APP_ENV).toBe('production');
  });

  it('reports every missing required key and treats empty values as missing', () => {
    const error = captureError(() =>
      parseWebEnv({ JWT_PRIVATE_KEY: '', CSRF_SECRET: '', HASH_SECRET: '' }),
    );
    expect(error.issues.map((issue) => issue.key).sort()).toEqual(
      [
        'APPLE_AUDIENCES',
        'APP_ENV',
        'BUILD_SHA',
        'CORS_ALLOWED_ORIGINS',
        'CSRF_SECRET',
        'DATABASE_URL',
        'GOOGLE_CLIENT_IDS',
        'HASH_SECRET',
        'JWT_PRIVATE_KEY',
        'JWT_PUBLIC_KEY',
        'LOG_LEVEL',
        'NODE_ENV',
        'WEB_ORIGIN',
      ].sort(),
    );
    expect(error.issues.every((issue) => issue.message === 'is required')).toBe(true);
  });

  it('rejects build identifiers with unsafe characters', () => {
    expect(webIssueKeys({ BUILD_SHA: 'abc; rm -rf /' })).toEqual(['BUILD_SHA']);
  });

  it('accepts PEM values written on one line with escaped line breaks', () => {
    const env = parseWebEnv({
      ...validWeb,
      JWT_PRIVATE_KEY: keys.privatePem.trim().replaceAll('\n', '\\n'),
      JWT_PUBLIC_KEY: keys.publicPem.trim().replaceAll('\n', '\\n'),
    });
    expect(env.JWT_PRIVATE_KEY).toBe(keys.privatePem.trim());
    expect(env.JWT_PUBLIC_KEY).toBe(keys.publicPem.trim());
  });

  it('rejects JWT keys that are not EC P-256', () => {
    const rsa = rsaPair();
    expect(
      webIssueKeys({ JWT_PRIVATE_KEY: rsa.privatePem, JWT_PUBLIC_KEY: rsa.publicPem }).sort(),
    ).toEqual(['JWT_PRIVATE_KEY', 'JWT_PUBLIC_KEY']);

    const p384 = ecPair('P-384');
    expect(webIssueKeys({ JWT_PRIVATE_KEY: p384.privatePem })).toEqual(['JWT_PRIVATE_KEY']);
    expect(webIssueKeys({ JWT_PUBLIC_KEY: p384.publicPem })).toEqual(['JWT_PUBLIC_KEY']);
  });

  it('rejects a public key in the private key slot and garbage key material', () => {
    expect(webIssueKeys({ JWT_PRIVATE_KEY: keys.publicPem })).toEqual(['JWT_PRIVATE_KEY']);
    expect(webIssueKeys({ JWT_PUBLIC_KEY: 'not a key' })).toEqual(['JWT_PUBLIC_KEY']);
  });

  it('rejects a public key that does not belong to the private key, without echoing keys', () => {
    const other = es256Pair();
    const error = captureError(() => parseWebEnv({ ...validWeb, JWT_PUBLIC_KEY: other.publicPem }));
    expect(error.issues).toEqual([
      { key: 'JWT_PUBLIC_KEY', message: 'must be the public half of JWT_PRIVATE_KEY' },
    ]);
    expect(error.message).not.toContain('BEGIN');
  });

  it('requires a 256-bit CSRF secret', () => {
    expect(webIssueKeys({ CSRF_SECRET: 'short-secret' })).toEqual(['CSRF_SECRET']);
    expect(webIssueKeys({ CSRF_SECRET: 'a'.repeat(42) })).toEqual(['CSRF_SECRET']);
    expect(webIssueKeys({ CSRF_SECRET: `${'a'.repeat(42)}+` })).toEqual(['CSRF_SECRET']);
    expect(webIssueKeys({ CSRF_SECRET: 'a'.repeat(43) })).toEqual([]);
  });

  it('requires a 256-bit hash secret distinct from the CSRF secret', () => {
    expect(webIssueKeys({ HASH_SECRET: 'short-secret' })).toEqual(['HASH_SECRET']);
    expect(webIssueKeys({ HASH_SECRET: 'b'.repeat(42) })).toEqual(['HASH_SECRET']);
    expect(webIssueKeys({ HASH_SECRET: `${'b'.repeat(42)}/` })).toEqual(['HASH_SECRET']);
    expect(webIssueKeys({ HASH_SECRET: 'b'.repeat(43) })).toEqual([]);
    expect(webIssueKeys({ CSRF_SECRET: 'c'.repeat(43), HASH_SECRET: 'c'.repeat(43) })).toEqual([
      'HASH_SECRET',
    ]);
    const error = captureError(() => parseWebEnv({ ...validWeb, HASH_SECRET: 'leaky-value' }));
    expect(error.message).not.toContain('leaky-value');
  });

  it('enforces token lifetime bounds and their ordering', () => {
    expect(webIssueKeys({ ACCESS_TOKEN_TTL_SECONDS: '59' })).toEqual(['ACCESS_TOKEN_TTL_SECONDS']);
    expect(webIssueKeys({ ACCESS_TOKEN_TTL_SECONDS: '3601' })).toEqual([
      'ACCESS_TOKEN_TTL_SECONDS',
    ]);
    expect(webIssueKeys({ ACCESS_TOKEN_TTL_SECONDS: '15m' })).toEqual(['ACCESS_TOKEN_TTL_SECONDS']);
    expect(webIssueKeys({ REFRESH_TOKEN_TTL_SECONDS: '86399' })).toEqual([
      'REFRESH_TOKEN_TTL_SECONDS',
    ]);
    expect(webIssueKeys({ REFRESH_TOKEN_TTL_SECONDS: '7776001' })).toEqual([
      'REFRESH_TOKEN_TTL_SECONDS',
    ]);
    expect(
      webIssueKeys({ ACCESS_TOKEN_TTL_SECONDS: '60', REFRESH_TOKEN_TTL_SECONDS: '7776000' }),
    ).toEqual([]);
    expect(
      webIssueKeys({ ACCESS_TOKEN_TTL_SECONDS: '3600', REFRESH_TOKEN_TTL_SECONDS: '86400' }),
    ).toEqual([]);
  });

  it('requires __Host- cookie names that differ from each other', () => {
    expect(webIssueKeys({ SESSION_COOKIE_NAME: 'kadro_session' })).toEqual(['SESSION_COOKIE_NAME']);
    expect(webIssueKeys({ CSRF_COOKIE_NAME: '__Secure-kadro_csrf' })).toEqual(['CSRF_COOKIE_NAME']);
    expect(
      webIssueKeys({ SESSION_COOKIE_NAME: '__Host-same', CSRF_COOKIE_NAME: '__Host-same' }),
    ).toEqual(['CSRF_COOKIE_NAME']);
  });

  it('rejects wildcard, path-bearing and null CORS origins', () => {
    for (const value of ['*', 'https://*.kadro.app', 'https://kadro.app/', 'null', 'kadro.app']) {
      expect(webIssueKeys({ CORS_ALLOWED_ORIGINS: value })[0]).toMatch(/^CORS_ALLOWED_ORIGINS/);
    }
  });

  it('requires WEB_ORIGIN to be one of the CORS origins', () => {
    expect(webIssueKeys({ CORS_ALLOWED_ORIGINS: 'http://localhost:8081' })).toEqual([
      'CORS_ALLOWED_ORIGINS',
    ]);
  });

  it('requires https and non-loopback origins outside local', () => {
    expect(
      webIssueKeys({
        ...validProductionWeb,
        WEB_ORIGIN: 'http://kadro.app',
        CORS_ALLOWED_ORIGINS: 'http://kadro.app,https://localhost:3000',
      }),
    ).toEqual(['WEB_ORIGIN', 'CORS_ALLOWED_ORIGINS.0', 'CORS_ALLOWED_ORIGINS.1']);
  });

  it('validates trusted proxy entries and the client IP header', () => {
    expect(
      parseWebEnv({ ...validWeb, TRUSTED_PROXY_CIDRS: '10.0.0.0/8, 172.16.0.1 ,::1/128,' })
        .TRUSTED_PROXY_CIDRS,
    ).toEqual(['10.0.0.0/8', '172.16.0.1', '::1/128']);
    for (const value of [
      '10.0.0.0/33',
      '::1/129',
      '10.0.0.0/8/1',
      'proxy.internal',
      '10.0.0.0/x',
    ]) {
      expect(webIssueKeys({ TRUSTED_PROXY_CIDRS: value })[0]).toMatch(/^TRUSTED_PROXY_CIDRS/);
    }
    expect(webIssueKeys({ CLIENT_IP_HEADER: 'x-client-ip' })).toEqual(['CLIENT_IP_HEADER']);
  });

  it('bounds rate-limit settings', () => {
    expect(webIssueKeys({ RATE_LIMIT_AUTH_MAX: '0' })).toContain('RATE_LIMIT_AUTH_MAX');
    expect(webIssueKeys({ RATE_LIMIT_AUTH_MAX: '-1' })).toContain('RATE_LIMIT_AUTH_MAX');
    expect(webIssueKeys({ RATE_LIMIT_AUTH_MAX: '101' })).toEqual(['RATE_LIMIT_AUTH_MAX']);
    expect(
      webIssueKeys({ RATE_LIMIT_AUTH_MAX: '1', RATE_LIMIT_AUTH_DELAY_AFTER_FAILURES: '1' }),
    ).toEqual([]);
    expect(webIssueKeys({ RATE_LIMIT_AUTH_WINDOW_SECONDS: '59' })).toEqual([
      'RATE_LIMIT_AUTH_WINDOW_SECONDS',
    ]);
    expect(
      webIssueKeys({ RATE_LIMIT_AUTH_MAX: '2', RATE_LIMIT_AUTH_DELAY_AFTER_FAILURES: '3' }),
    ).toEqual(['RATE_LIMIT_AUTH_DELAY_AFTER_FAILURES']);
  });

  it('validates provider audiences', () => {
    expect(webIssueKeys({ GOOGLE_CLIENT_IDS: 'my-client' })).toEqual(['GOOGLE_CLIENT_IDS.0']);
    expect(webIssueKeys({ APPLE_AUDIENCES: ' , ' })).toEqual(['APPLE_AUDIENCES']);
    expect(
      parseWebEnv({ ...validWeb, APPLE_AUDIENCES: 'app.kadro.mobile,app.kadro.web' })
        .APPLE_AUDIENCES,
    ).toEqual(['app.kadro.mobile', 'app.kadro.web']);
  });

  it('requires NODE_ENV=production outside local', () => {
    expect(webIssueKeys({ ...validProductionWeb, NODE_ENV: 'development' })).toEqual(['NODE_ENV']);
  });

  it('defaults email delivery to the local log transport', () => {
    const env = parseWebEnv(validWeb);
    expect(env.EMAIL_TRANSPORT).toBe('log');
    expect(env.RESEND_API_KEY).toBeUndefined();
    expect(env.EMAIL_FROM).toBe('Kadro <bildirim@kadro.app>');
  });

  it('refuses the log email transport outside local', () => {
    expect(
      webIssueKeys({ ...validProductionWeb, EMAIL_TRANSPORT: 'log', RESEND_API_KEY: undefined }),
    ).toEqual(['EMAIL_TRANSPORT']);
    expect(webIssueKeys({ ...validProductionWeb, EMAIL_TRANSPORT: undefined })).toEqual([
      'EMAIL_TRANSPORT',
    ]);
  });

  it('requires a Resend API key for the resend transport, without echoing it', () => {
    expect(webIssueKeys({ EMAIL_TRANSPORT: 'resend' })).toEqual(['RESEND_API_KEY']);
    expect(webIssueKeys({ EMAIL_TRANSPORT: 'smtp' })).toEqual(['EMAIL_TRANSPORT']);
    const badKey = ['s', 'k_not_a_resend_key'].join('');
    const error = captureError(() =>
      parseWebEnv({ ...validWeb, EMAIL_TRANSPORT: 'resend', RESEND_API_KEY: badKey }),
    );
    expect(error.issues.map((issue) => issue.key)).toEqual(['RESEND_API_KEY']);
    expect(error.message).not.toContain(badKey);
  });

  it('validates the sender and rejects header injection', () => {
    expect(webIssueKeys({ EMAIL_FROM: 'bildirim@kadro.app' })).toEqual([]);
    expect(webIssueKeys({ EMAIL_FROM: 'Kadro <bildirim@kadro.app>' })).toEqual([]);
    expect(webIssueKeys({ EMAIL_FROM: 'Kadro <bildirim@kadro.app>\r\nBcc: x@y.z' })).toEqual([
      'EMAIL_FROM',
    ]);
    expect(webIssueKeys({ EMAIL_FROM: 'not an address' })).toEqual(['EMAIL_FROM']);
  });

  it('leaves upload storage and the media URL optional locally, all four R2 keys together', () => {
    const env = parseWebEnv(validWeb);
    expect(env.R2_ENDPOINT).toBeUndefined();
    expect(env.MEDIA_PUBLIC_BASE_URL).toBeUndefined();
    expect(webIssueKeys(localWebStorage)).toEqual([]);
    expect(
      webIssueKeys({
        ...localWebStorage,
        MEDIA_PUBLIC_BASE_URL: 'https://localhost:9443/kadro-media',
      }),
    ).toEqual([]);
    // Loopback http stays valid for the storage connection only, never for the public URL.
    expect(
      webIssueKeys({
        ...localWebStorage,
        R2_ENDPOINT: 'http://localhost:9000',
        MEDIA_PUBLIC_BASE_URL: 'http://localhost:9000/kadro-media',
      }),
    ).toEqual(['MEDIA_PUBLIC_BASE_URL']);
    expect(webIssueKeys({ R2_ENDPOINT: 'http://localhost:9000' }).sort()).toEqual([
      'R2_ACCESS_KEY_ID',
      'R2_INCOMING_BUCKET',
      'R2_SECRET_ACCESS_KEY',
    ]);
  });

  it('requires upload storage and an https media URL outside local, without echoing the key', () => {
    expect(
      webIssueKeys({
        ...validProductionWeb,
        R2_ENDPOINT: undefined,
        R2_ACCESS_KEY_ID: undefined,
        R2_SECRET_ACCESS_KEY: undefined,
        R2_INCOMING_BUCKET: undefined,
        MEDIA_PUBLIC_BASE_URL: undefined,
      }).sort(),
    ).toEqual(
      [
        'MEDIA_PUBLIC_BASE_URL',
        'R2_ACCESS_KEY_ID',
        'R2_ENDPOINT',
        'R2_INCOMING_BUCKET',
        'R2_SECRET_ACCESS_KEY',
      ].sort(),
    );
    expect(
      webIssueKeys({
        ...validProductionWeb,
        R2_ENDPOINT: 'http://localhost:9000',
        MEDIA_PUBLIC_BASE_URL: 'http://media.kadro.app',
      }),
    ).toEqual(['R2_ENDPOINT', 'MEDIA_PUBLIC_BASE_URL']);
    for (const value of [
      'https://user:pw@media.kadro.app',
      'https://media.kadro.app/?a=1',
      'ftp://media.kadro.app',
    ]) {
      expect(webIssueKeys({ ...validProductionWeb, MEDIA_PUBLIC_BASE_URL: value })).toEqual([
        'MEDIA_PUBLIC_BASE_URL',
      ]);
    }
    const secret = 'not a secret!';
    const error = captureError(() =>
      parseWebEnv({ ...validProductionWeb, R2_SECRET_ACCESS_KEY: secret }),
    );
    expect(error.issues.map((issue) => issue.key)).toEqual(['R2_SECRET_ACCESS_KEY']);
    expect(error.message).not.toContain(secret);
  });

  it('leaves the webhook secret and TOTP key optional locally, required outside local', () => {
    const env = parseWebEnv(validWeb);
    expect(env.REVENUECAT_WEBHOOK_SECRET).toBeUndefined();
    expect(env.TOTP_ENCRYPTION_KEY).toBeUndefined();
    expect(
      webIssueKeys({
        ...validProductionWeb,
        REVENUECAT_WEBHOOK_SECRET: undefined,
        TOTP_ENCRYPTION_KEY: undefined,
      }).sort(),
    ).toEqual(['REVENUECAT_WEBHOOK_SECRET', 'TOTP_ENCRYPTION_KEY']);
  });

  it('requires a 32-byte TOTP key and distinct secrets, without echoing them', () => {
    expect(webIssueKeys({ TOTP_ENCRYPTION_KEY: randomBytes(32).toString('base64url') })).toEqual(
      [],
    );
    for (const value of [
      randomBytes(31).toString('base64url'),
      randomBytes(48).toString('base64url'),
      `${'a'.repeat(42)}+`,
    ]) {
      const error = captureError(() => parseWebEnv({ ...validWeb, TOTP_ENCRYPTION_KEY: value }));
      expect(error.issues.map((issue) => issue.key)).toEqual(['TOTP_ENCRYPTION_KEY']);
      expect(error.message).not.toContain(value);
    }
    // 43 characters whose last one carries bits beyond 32 bytes do not decode exactly.
    expect(webIssueKeys({ TOTP_ENCRYPTION_KEY: `${'A'.repeat(42)}B` })).toEqual([
      'TOTP_ENCRYPTION_KEY',
    ]);
    expect(webIssueKeys({ REVENUECAT_WEBHOOK_SECRET: 'short' })).toEqual([
      'REVENUECAT_WEBHOOK_SECRET',
    ]);
    expect(webIssueKeys({ REVENUECAT_WEBHOOK_SECRET: validWeb.CSRF_SECRET })).toEqual([
      'REVENUECAT_WEBHOOK_SECRET',
    ]);
  });

  it('validates the app-linking identifiers and keeps them optional', () => {
    const env = parseWebEnv(validProductionWeb);
    expect(env.APPLE_TEAM_ID).toBeUndefined();
    expect(env.ANDROID_CERT_SHA256_FINGERPRINTS).toBeUndefined();
    const fingerprint = () =>
      randomBytes(32).toString('hex').toUpperCase().match(/.{2}/g)?.join(':') ?? '';
    const first = fingerprint();
    const second = fingerprint();
    const parsed = parseWebEnv({
      ...validWeb,
      APPLE_TEAM_ID: 'ABCDE12345',
      APPLE_APP_STORE_ID: '1234567890',
      ANDROID_CERT_SHA256_FINGERPRINTS: `${first}, ${second}`,
    });
    expect(parsed.ANDROID_CERT_SHA256_FINGERPRINTS).toEqual([first, second]);
    expect(webIssueKeys({ APPLE_TEAM_ID: 'abcde12345' })).toEqual(['APPLE_TEAM_ID']);
    expect(webIssueKeys({ APPLE_APP_STORE_ID: 'id123456' })).toEqual(['APPLE_APP_STORE_ID']);
    expect(webIssueKeys({ ANDROID_CERT_SHA256_FINGERPRINTS: first.toLowerCase() })).toEqual([
      'ANDROID_CERT_SHA256_FINGERPRINTS.0',
    ]);
  });
});

describe('parseMobilePublicEnv', () => {
  it('allows plain http for the local environment', () => {
    expect(
      parseMobilePublicEnv({
        EXPO_PUBLIC_APP_ENV: 'local',
        EXPO_PUBLIC_API_URL: 'http://localhost:3000',
      }).EXPO_PUBLIC_API_URL,
    ).toBe('http://localhost:3000');
  });

  const WEB_ORIGIN = { EXPO_PUBLIC_WEB_ORIGIN: 'https://kadro.app' };

  it('requires https for preview and production builds', () => {
    for (const appEnv of ['preview', 'production']) {
      const error = captureError(() =>
        parseMobilePublicEnv({
          ...WEB_ORIGIN,
          EXPO_PUBLIC_APP_ENV: appEnv,
          EXPO_PUBLIC_API_URL: 'http://kadro.app',
        }),
      );
      expect(error.issues.map((issue) => issue.key)).toEqual(['EXPO_PUBLIC_API_URL']);
    }
    expect(
      parseMobilePublicEnv({
        ...WEB_ORIGIN,
        EXPO_PUBLIC_APP_ENV: 'production',
        EXPO_PUBLIC_API_URL: 'https://kadro.app',
      }).EXPO_PUBLIC_APP_ENV,
    ).toBe('production');
  });

  it('rejects API URLs with credentials, query strings or fragments', () => {
    for (const url of [
      'https://user:pass@kadro.app',
      'https://kadro.app/?debug=1',
      'https://kadro.app/#x',
    ]) {
      const error = captureError(() =>
        parseMobilePublicEnv({
          ...WEB_ORIGIN,
          EXPO_PUBLIC_APP_ENV: 'production',
          EXPO_PUBLIC_API_URL: url,
        }),
      );
      expect(error.issues.map((issue) => issue.key)).toEqual(['EXPO_PUBLIC_API_URL']);
    }
  });

  it('requires a non-loopback https web origin outside local and allows none locally', () => {
    const local = { EXPO_PUBLIC_APP_ENV: 'local', EXPO_PUBLIC_API_URL: 'http://localhost:3000' };
    expect(parseMobilePublicEnv(local).EXPO_PUBLIC_WEB_ORIGIN).toBeUndefined();
    expect(
      parseMobilePublicEnv({ ...local, EXPO_PUBLIC_WEB_ORIGIN: 'http://localhost:3000' })
        .EXPO_PUBLIC_WEB_ORIGIN,
    ).toBe('http://localhost:3000');
    const production = {
      EXPO_PUBLIC_APP_ENV: 'production',
      EXPO_PUBLIC_API_URL: 'https://kadro.app',
    };
    for (const value of [undefined, 'http://kadro.app', 'https://localhost:3000']) {
      const error = captureError(() =>
        parseMobilePublicEnv({ ...production, EXPO_PUBLIC_WEB_ORIGIN: value }),
      );
      expect(error.issues.map((issue) => issue.key)).toEqual(['EXPO_PUBLIC_WEB_ORIGIN']);
    }
    for (const value of ['https://kadro.app/', 'https://kadro.app/mac', 'kadro.app']) {
      const error = captureError(() =>
        parseMobilePublicEnv({ ...local, EXPO_PUBLIC_WEB_ORIGIN: value }),
      );
      expect(error.issues.map((issue) => issue.key)).toEqual(['EXPO_PUBLIC_WEB_ORIGIN']);
    }
  });

  it('accepts only public RevenueCat SDK keys of the matching platform', () => {
    const local = { EXPO_PUBLIC_APP_ENV: 'local', EXPO_PUBLIC_API_URL: 'http://localhost:3000' };
    const ios = `appl_${randomBytes(12).toString('hex')}`;
    const android = `goog_${randomBytes(12).toString('hex')}`;
    const env = parseMobilePublicEnv({
      ...local,
      EXPO_PUBLIC_REVENUECAT_IOS_API_KEY: ios,
      EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY: android,
    });
    expect(env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY).toBe(ios);
    expect(env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY).toBe(android);
    const secretShaped = ['s', 'k_', randomBytes(12).toString('hex')].join('');
    const error = captureError(() =>
      parseMobilePublicEnv({
        ...local,
        EXPO_PUBLIC_REVENUECAT_IOS_API_KEY: android,
        EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY: secretShaped,
      }),
    );
    expect(error.issues.map((issue) => issue.key).sort()).toEqual([
      'EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY',
      'EXPO_PUBLIC_REVENUECAT_IOS_API_KEY',
    ]);
    expect(error.message).not.toContain(secretShaped);
  });

  it('rejects non-http schemes and treats an empty URL as missing', () => {
    expect(
      captureError(() =>
        parseMobilePublicEnv({
          EXPO_PUBLIC_APP_ENV: 'local',
          EXPO_PUBLIC_API_URL: 'ftp://kadro.app',
        }),
      ).issues.map((issue) => issue.key),
    ).toEqual(['EXPO_PUBLIC_API_URL']);
    expect(
      captureError(() =>
        parseMobilePublicEnv({ EXPO_PUBLIC_APP_ENV: 'local', EXPO_PUBLIC_API_URL: '' }),
      ).issues,
    ).toEqual([{ key: 'EXPO_PUBLIC_API_URL', message: 'is required' }]);
  });
});

describe('parseDatabaseEnv', () => {
  const validDatabase = {
    NODE_ENV: 'development',
    APP_ENV: 'local',
    DATABASE_URL: 'postgres://kadro:kadro@localhost:5432/kadro',
  };

  it('accepts a database-only environment and ignores every other key', () => {
    expect(
      parseDatabaseEnv({
        ...validDatabase,
        EMAIL_TRANSPORT: 'resend',
        RESEND_API_KEY: 're_unrelated',
        JWT_PRIVATE_KEY: 'not validated here',
      }),
    ).toEqual(validDatabase);
  });

  it('does not require web or worker keys outside local', () => {
    expect(
      parseDatabaseEnv({ ...validDatabase, NODE_ENV: 'production', APP_ENV: 'production' }).APP_ENV,
    ).toBe('production');
  });

  it('reports exactly the three missing keys as required', () => {
    const error = captureError(() => parseDatabaseEnv({ DATABASE_URL: '' }));
    expect(error.issues.map((issue) => issue.key).sort()).toEqual([
      'APP_ENV',
      'DATABASE_URL',
      'NODE_ENV',
    ]);
    expect(error.issues.every((issue) => issue.message === 'is required')).toBe(true);
    expect(error.message).toContain('Invalid database configuration');
  });

  it('rejects non-postgres URLs without echoing the value', () => {
    const error = captureError(() =>
      parseDatabaseEnv({ ...validDatabase, DATABASE_URL: 'mysql://root:hunter2@db:3306/kadro' }),
    );
    expect(error.issues.map((issue) => issue.key)).toEqual(['DATABASE_URL']);
    expect(error.message).not.toContain('hunter2');
  });

  it('requires NODE_ENV=production outside local', () => {
    const error = captureError(() => parseDatabaseEnv({ ...validDatabase, APP_ENV: 'preview' }));
    expect(error.issues.map((issue) => issue.key)).toEqual(['NODE_ENV']);
  });

  it('is exported as a loader that reads the process environment', () => {
    expect(typeof loadDatabaseEnv).toBe('function');
  });
});
