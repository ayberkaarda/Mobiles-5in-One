import { createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';
import { isIP } from 'node:net';

import { z } from 'zod';

import {
  type AppEnvironment,
  appEnvironmentSchema,
  LOG_LEVELS,
  NODE_ENVIRONMENTS,
  type NodeEnvironment,
  parseUrl,
} from './shared.js';

export {
  APP_ENVIRONMENTS,
  LOG_LEVELS,
  NODE_ENVIRONMENTS,
  type AppEnvironment,
  type EnvSource,
  type LogLevel,
  type NodeEnvironment,
} from './shared.js';
export { mobilePublicEnvSchema, type MobilePublicEnv } from './mobile-schema.js';

/** Request headers the trusted reverse proxy may use to pass the client address. */
export const CLIENT_IP_HEADERS = ['x-forwarded-for', 'x-real-ip', 'cf-connecting-ip'] as const;
export type ClientIpHeader = (typeof CLIENT_IP_HEADERS)[number];

// ---------------------------------------------------------------------------
// Field schemas
// ---------------------------------------------------------------------------

const buildSha = z
  .string()
  .regex(/^[A-Za-z0-9._-]{1,64}$/, 'must be 1-64 characters of [A-Za-z0-9._-]');

const postgresUrl = z.string().refine((value) => {
  const url = parseUrl(value);
  return url !== null && (url.protocol === 'postgres:' || url.protocol === 'postgresql:');
}, 'must be a postgres:// or postgresql:// connection URL');

/** Integer read from a string, bounded, with a default used when the key is unset. */
function intSetting(min: number, max: number, fallback: number) {
  return z
    .string()
    .regex(/^[0-9]+$/, 'must be a non-negative integer')
    .transform(Number)
    .pipe(
      z
        .number()
        .int()
        .min(min, `must be between ${min} and ${max}`)
        .max(max, `must be between ${min} and ${max}`),
    )
    .default(fallback);
}

/** Comma-separated list; surrounding whitespace and empty entries are ignored. */
function csv<TItem extends z.ZodType<string, string>>(item: TItem) {
  return z
    .string()
    .transform((value) =>
      value
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    )
    .pipe(z.array(item));
}

/** A browser origin: scheme, host and optional port only, e.g. `https://kadro.app`. */
const origin = z.string().refine((value) => {
  const url = parseUrl(value);
  return (
    url !== null &&
    (url.protocol === 'http:' || url.protocol === 'https:') &&
    url.origin === value &&
    value !== 'null'
  );
}, 'must be an origin such as https://kadro.app (no path, no trailing slash, no wildcard)');

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '[::1]' ||
    hostname === '127.0.0.1' ||
    hostname.endsWith('.localhost')
  );
}

/** `10.0.0.0/8`, `127.0.0.1` or `::1/128`. A bare address means a single host. */
const ipOrCidr = z.string().refine((value) => {
  const [address = '', prefix, ...rest] = value.split('/');
  const family = isIP(address);
  if (family === 0 || rest.length > 0) {
    return false;
  }
  if (prefix === undefined) {
    return true;
  }
  if (!/^[0-9]{1,3}$/.test(prefix)) {
    return false;
  }
  return Number(prefix) <= (family === 4 ? 32 : 128);
}, 'must be an IPv4/IPv6 address or CIDR range');

/** Secret with at least 256 bits of entropy, encoded as base64url (43+ characters). */
const secret256 = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43,}$/, 'must be at least 43 base64url characters (256 bits)');

const SESSION_COOKIE_DEFAULT = '__Host-kadro_session';
const CSRF_COOKIE_DEFAULT = '__Host-kadro_csrf';

/**
 * Cookie names must carry the `__Host-` prefix so browsers enforce Secure, Path=/ and no Domain
 * attribute (security checklist item 12).
 */
const hostCookieName = z
  .string()
  .regex(/^__Host-[A-Za-z0-9_-]{1,64}$/, 'must start with __Host- followed by [A-Za-z0-9_-]');

/**
 * PEM value from the environment. Single-line `.env` values may encode line breaks as the two
 * characters `\n`; both forms are accepted.
 */
const pem = z.string().transform((value) => value.replace(/\\n/g, '\n').trim());

function loadEcP256(value: string, kind: 'private' | 'public'): KeyObject | null {
  try {
    const key = kind === 'private' ? createPrivateKey(value) : createPublicKey(value);
    if (key.type !== kind || key.asymmetricKeyType !== 'ec') {
      return null;
    }
    return key.asymmetricKeyDetails?.namedCurve === 'prime256v1' ? key : null;
  } catch {
    return null;
  }
}

const jwtPrivateKey = pem.refine(
  (value) => loadEcP256(value, 'private') !== null,
  'must be a PEM-encoded EC P-256 private key (PKCS#8) for ES256',
);

const jwtPublicKey = pem.refine(
  (value) => loadEcP256(value, 'public') !== null,
  'must be a PEM-encoded EC P-256 public key (SPKI) for ES256',
);

function spkiDer(key: KeyObject): Buffer {
  return key.export({ type: 'spki', format: 'der' });
}

const googleClientId = z
  .string()
  .regex(
    /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/,
    'must be a Google OAuth client id (<number>-<id>.apps.googleusercontent.com)',
  );

/** Apple bundle id or Services id, e.g. `app.kadro.mobile`. */
const appleAudience = z.string().refine((value) => {
  const labels = value.split('.');
  return labels.length >= 2 && labels.every((label) => /^[A-Za-z0-9-]+$/.test(label));
}, 'must be a reverse-DNS bundle or services id');

/**
 * Outbound email transport: `resend` delivers through the Resend REST API; `log` writes the
 * rendered message (links included) to the server log for local development and is refused
 * outside the local environment.
 */
export const EMAIL_TRANSPORTS = ['log', 'resend'] as const;
export type EmailTransportKind = (typeof EMAIL_TRANSPORTS)[number];

/** Resend API key: `re_` followed by base64url-like characters. */
const resendApiKey = z
  .string()
  .regex(/^re_[A-Za-z0-9_-]{16,128}$/, 'must be a Resend API key (re_...)');

/** Sender as `address` or `Display Name <address>`; no line breaks (header injection). */
const emailSender = z
  .string()
  .max(200)
  .regex(
    /^(?:[A-Za-z0-9 .'-]{1,64} <[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}>|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})$/,
    'must be an email address or "Name <address>"',
  );

/** S3-compatible API endpoint (Cloudflare R2, local MinIO): scheme, host and port only. */
const storageEndpoint = z.string().refine((value) => {
  const url = parseUrl(value);
  return (
    url !== null &&
    (url.protocol === 'http:' || url.protocol === 'https:') &&
    url.username === '' &&
    url.password === '' &&
    url.search === '' &&
    url.hash === '' &&
    (url.pathname === '/' || url.pathname === '')
  );
}, 'must be an http(s) endpoint without path, query or credentials');

/** S3 bucket naming rules (lowercase letters, digits, dots and hyphens; 3-63 characters). */
const bucketName = z
  .string()
  .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, 'must be a valid bucket name (3-63 of [a-z0-9.-])');

const storageAccessKeyId = z
  .string()
  .regex(/^[A-Za-z0-9_-]{3,128}$/, 'must be an access key id (3-128 of [A-Za-z0-9_-])');

const storageSecretAccessKey = z
  .string()
  .regex(/^[A-Za-z0-9/+=_-]{8,128}$/, 'must be a secret access key (8-128 characters)');

/**
 * Public base URL of the media bucket (ADR-0030): `avatarUrl` / `badgeUrl` are this value joined
 * with the stored key. Scheme, host, optional port and optional path; no credentials, query or
 * fragment.
 */
const mediaBaseUrl = z.string().refine((value) => {
  const url = parseUrl(value);
  return (
    url !== null &&
    (url.protocol === 'http:' || url.protocol === 'https:') &&
    url.username === '' &&
    url.password === '' &&
    url.search === '' &&
    url.hash === '' &&
    !value.includes('?') &&
    !value.includes('#')
  );
}, 'must be an http(s) URL without credentials, query or fragment');

// ---------------------------------------------------------------------------
// Cross-field rules
// ---------------------------------------------------------------------------

function requireProductionNodeEnv(
  env: { APP_ENV: AppEnvironment; NODE_ENV: NodeEnvironment },
  ctx: z.RefinementCtx,
): void {
  if (env.APP_ENV !== 'local' && env.NODE_ENV !== 'production') {
    ctx.addIssue({
      code: 'custom',
      path: ['NODE_ENV'],
      message: 'must be "production" when APP_ENV is preview or production',
    });
  }
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

/** Server-side configuration for apps/web (pages and API route handlers). */
export const webEnvSchema = z
  .object({
    NODE_ENV: z.enum(NODE_ENVIRONMENTS),
    APP_ENV: appEnvironmentSchema,
    BUILD_SHA: buildSha,
    LOG_LEVEL: z.enum(LOG_LEVELS),
    DATABASE_URL: postgresUrl,

    /** Canonical web origin: issuer of access tokens, the only credentialed CORS origin. */
    WEB_ORIGIN: origin,
    /** Origins allowed to call the API from a browser (item 8). Must include WEB_ORIGIN. */
    CORS_ALLOWED_ORIGINS: csv(origin).refine(
      (list) => list.length > 0,
      'must list at least one origin',
    ),

    /** ES256 signing key pair for access tokens (item 12). */
    JWT_PRIVATE_KEY: jwtPrivateKey,
    JWT_PUBLIC_KEY: jwtPublicKey,
    ACCESS_TOKEN_TTL_SECONDS: intSetting(60, 3_600, 900),
    REFRESH_TOKEN_TTL_SECONDS: intSetting(86_400, 7_776_000, 2_592_000),
    /** Web session lifetime; rolling, renewed on activity. */
    SESSION_TTL_SECONDS: intSetting(3_600, 2_592_000, 604_800),
    SESSION_COOKIE_NAME: hostCookieName.default(SESSION_COOKIE_DEFAULT),
    CSRF_COOKIE_NAME: hostCookieName.default(CSRF_COOKIE_DEFAULT),
    /** HMAC key for signed double-submit CSRF tokens. */
    CSRF_SECRET: secret256,
    /**
     * HMAC key for keyed hashes of personal data that must never be stored raw: rate-limit bucket
     * keys (IP, email) and `audit_logs.ip_hash`. Independent of CSRF_SECRET so either can rotate
     * alone.
     */
    HASH_SECRET: secret256,

    /** Identity token audiences accepted for Sign in with Apple and Google. */
    APPLE_AUDIENCES: csv(appleAudience).refine(
      (list) => list.length > 0,
      'must list at least one bundle or services id',
    ),
    GOOGLE_CLIENT_IDS: csv(googleClientId).refine(
      (list) => list.length > 0,
      'must list at least one client id',
    ),

    /**
     * Client IP resolution (item 5). The address is read only from CLIENT_IP_HEADER; hops whose
     * address falls inside TRUSTED_PROXY_CIDRS are skipped from the right, and the first remaining
     * address is the client. An empty list trusts only the edge proxy that set the header.
     */
    CLIENT_IP_HEADER: z.enum(CLIENT_IP_HEADERS).default('x-forwarded-for'),
    TRUSTED_PROXY_CIDRS: csv(ipOrCidr).default([]),

    /** Auth endpoint limits: requests per window, per IP and per email (item 5). */
    RATE_LIMIT_AUTH_MAX: intSetting(1, 100, 5),
    RATE_LIMIT_AUTH_WINDOW_SECONDS: intSetting(60, 86_400, 900),
    /** Progressive delay starts after this many failed attempts in the window. */
    RATE_LIMIT_AUTH_DELAY_AFTER_FAILURES: intSetting(1, 100, 3),
    /** Delay added per failure beyond the threshold, in milliseconds. */
    RATE_LIMIT_AUTH_DELAY_STEP_MS: intSetting(0, 10_000, 500),
    /** `auth/refresh` limit per refresh-token family. */
    RATE_LIMIT_REFRESH_MAX: intSetting(1, 1_000, 30),
    RATE_LIMIT_REFRESH_WINDOW_SECONDS: intSetting(60, 86_400, 900),

    /** Email delivery (verification, password reset). `log` is accepted only when APP_ENV=local. */
    EMAIL_TRANSPORT: z.enum(EMAIL_TRANSPORTS).default('log'),
    /** Required when EMAIL_TRANSPORT=resend. */
    RESEND_API_KEY: resendApiKey.optional(),
    EMAIL_FROM: emailSender.default('Kadro <bildirim@kadro.app>'),

    /**
     * Upload presigning (ADR-0030): the web key may only `PutObject` into the private incoming
     * bucket. Same key names as the worker; each service gets its own key pair outside local.
     * Required outside local; locally all four may be omitted together, and `POST
     * uploads/presign` then answers 503.
     */
    R2_ENDPOINT: storageEndpoint.optional(),
    R2_ACCESS_KEY_ID: storageAccessKeyId.optional(),
    R2_SECRET_ACCESS_KEY: storageSecretAccessKey.optional(),
    R2_INCOMING_BUCKET: bucketName.optional(),
    /**
     * Public base URL of the media bucket for `avatarUrl` / `badgeUrl` (ADR-0030). Required
     * outside local (https, non-loopback); locally optional (https only, loopback allowed), and
     * every image URL is then `null`.
     */
    MEDIA_PUBLIC_BASE_URL: mediaBaseUrl.optional(),
  })
  .superRefine((env, ctx) => {
    requireProductionNodeEnv(env, ctx);

    const local = env.APP_ENV === 'local';
    if (env.EMAIL_TRANSPORT === 'log' && !local) {
      ctx.addIssue({
        code: 'custom',
        path: ['EMAIL_TRANSPORT'],
        message: 'must be "resend" outside the local environment',
      });
    }
    if (env.EMAIL_TRANSPORT === 'resend' && env.RESEND_API_KEY === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['RESEND_API_KEY'],
        message: 'is required when EMAIL_TRANSPORT is "resend"',
      });
    }

    const storage = {
      R2_ENDPOINT: env.R2_ENDPOINT,
      R2_ACCESS_KEY_ID: env.R2_ACCESS_KEY_ID,
      R2_SECRET_ACCESS_KEY: env.R2_SECRET_ACCESS_KEY,
      R2_INCOMING_BUCKET: env.R2_INCOMING_BUCKET,
    };
    const storageSet = Object.values(storage).some((value) => value !== undefined);
    if (!local || storageSet) {
      for (const [key, value] of Object.entries(storage)) {
        if (value === undefined) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: local
              ? 'is required when any R2_* upload key is set'
              : 'is required outside the local environment',
          });
        }
      }
    }
    if (!local && env.MEDIA_PUBLIC_BASE_URL === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['MEDIA_PUBLIC_BASE_URL'],
        message: 'is required outside the local environment',
      });
    }
    // The public media URL is returned in API responses, whose contract requires https. Locally
    // a loopback host is fine, but plain http is not; only R2_ENDPOINT may stay http locally.
    if (local && env.MEDIA_PUBLIC_BASE_URL !== undefined) {
      const mediaUrl = parseUrl(env.MEDIA_PUBLIC_BASE_URL);
      if (mediaUrl !== null && mediaUrl.protocol === 'http:') {
        ctx.addIssue({
          code: 'custom',
          path: ['MEDIA_PUBLIC_BASE_URL'],
          message: 'must be an https:// URL (a loopback host is allowed locally)',
        });
      }
    }
    if (!local) {
      for (const [key, value] of [
        ['R2_ENDPOINT', env.R2_ENDPOINT],
        ['MEDIA_PUBLIC_BASE_URL', env.MEDIA_PUBLIC_BASE_URL],
      ] as const) {
        const url = value === undefined ? null : parseUrl(value);
        // Other schemes already failed the field rule; only http and loopback hosts remain.
        if (
          url !== null &&
          (url.protocol === 'http:' || (url.protocol === 'https:' && isLoopbackHost(url.hostname)))
        ) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: 'must be a non-loopback https:// URL outside the local environment',
          });
        }
      }
    }

    const checkOrigin = (value: string, path: (string | number)[]): void => {
      const url = parseUrl(value);
      if (url === null || local) {
        return;
      }
      if (url.protocol !== 'https:' || isLoopbackHost(url.hostname)) {
        ctx.addIssue({
          code: 'custom',
          path,
          message: 'must be a non-loopback https:// origin outside the local environment',
        });
      }
    };
    checkOrigin(env.WEB_ORIGIN, ['WEB_ORIGIN']);
    env.CORS_ALLOWED_ORIGINS.forEach((value, index) => {
      checkOrigin(value, ['CORS_ALLOWED_ORIGINS', index]);
    });
    if (!env.CORS_ALLOWED_ORIGINS.includes(env.WEB_ORIGIN)) {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ALLOWED_ORIGINS'],
        message: 'must include WEB_ORIGIN',
      });
    }

    if (env.REFRESH_TOKEN_TTL_SECONDS <= env.ACCESS_TOKEN_TTL_SECONDS) {
      ctx.addIssue({
        code: 'custom',
        path: ['REFRESH_TOKEN_TTL_SECONDS'],
        message: 'must be longer than ACCESS_TOKEN_TTL_SECONDS',
      });
    }
    if (env.SESSION_COOKIE_NAME === env.CSRF_COOKIE_NAME) {
      ctx.addIssue({
        code: 'custom',
        path: ['CSRF_COOKIE_NAME'],
        message: 'must differ from SESSION_COOKIE_NAME',
      });
    }
    if (env.HASH_SECRET === env.CSRF_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['HASH_SECRET'],
        message: 'must differ from CSRF_SECRET',
      });
    }
    if (env.RATE_LIMIT_AUTH_DELAY_AFTER_FAILURES > env.RATE_LIMIT_AUTH_MAX) {
      ctx.addIssue({
        code: 'custom',
        path: ['RATE_LIMIT_AUTH_DELAY_AFTER_FAILURES'],
        message: 'must not exceed RATE_LIMIT_AUTH_MAX',
      });
    }

    const privateKey = loadEcP256(env.JWT_PRIVATE_KEY, 'private');
    const publicKey = loadEcP256(env.JWT_PUBLIC_KEY, 'public');
    if (
      privateKey !== null &&
      publicKey !== null &&
      !spkiDer(createPublicKey(privateKey)).equals(spkiDer(publicKey))
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_PUBLIC_KEY'],
        message: 'must be the public half of JWT_PRIVATE_KEY',
      });
    }
  });
export type WebEnv = z.infer<typeof webEnvSchema>;

/**
 * Push delivery transport of the worker (ADR-0031): `expo` calls the Expo Push API; `log` writes
 * the notification to the worker log for local development and is refused outside local.
 */
export const PUSH_TRANSPORTS = ['log', 'expo'] as const;
export type PushTransportKind = (typeof PUSH_TRANSPORTS)[number];

/** Expo access token (enhanced push security): opaque base64url-like string. */
const expoAccessToken = z
  .string()
  .regex(/^[A-Za-z0-9_-]{20,200}$/, 'must be an Expo access token (20-200 base64url characters)');

/**
 * Database-only configuration for the migration and seed CLIs and other tools that need nothing
 * but a connection (packages/db). Deliberately excludes every app secret and transport key.
 */
export const databaseEnvSchema = z
  .object({
    NODE_ENV: z.enum(NODE_ENVIRONMENTS),
    APP_ENV: appEnvironmentSchema,
    DATABASE_URL: postgresUrl,
  })
  .superRefine(requireProductionNodeEnv);
export type DatabaseEnv = z.infer<typeof databaseEnvSchema>;

/** Configuration for apps/worker (pg-boss job runner). */
export const workerEnvSchema = z
  .object({
    NODE_ENV: z.enum(NODE_ENVIRONMENTS),
    APP_ENV: appEnvironmentSchema,
    BUILD_SHA: buildSha,
    LOG_LEVEL: z.enum(LOG_LEVELS),
    DATABASE_URL: postgresUrl,

    /** Origin of the web app; email links are built on it (ADR-0029). */
    WEB_ORIGIN: origin,

    /** Email delivery (ADR-0029). `log` is accepted only when APP_ENV=local. */
    EMAIL_TRANSPORT: z.enum(EMAIL_TRANSPORTS).default('log'),
    /** Required when EMAIL_TRANSPORT=resend. */
    RESEND_API_KEY: resendApiKey.optional(),
    EMAIL_FROM: emailSender.default('Kadro <bildirim@kadro.app>'),

    /** Push delivery (ADR-0031). `log` is accepted only when APP_ENV=local. */
    PUSH_TRANSPORT: z.enum(PUSH_TRANSPORTS).default('log'),
    /** Required when PUSH_TRANSPORT=expo. */
    EXPO_ACCESS_TOKEN: expoAccessToken.optional(),
    /** Global push sends per hour before notifications are dropped (security checklist item 22). */
    PUSH_HOURLY_CAP: intSetting(1, 100_000, 5_000),

    /**
     * Object storage of the worker (ADR-0030, ADR-0032): read and delete the private incoming
     * bucket, read, write and delete the media bucket. The web app has its own write-only key.
     */
    R2_ENDPOINT: storageEndpoint,
    R2_ACCESS_KEY_ID: storageAccessKeyId,
    R2_SECRET_ACCESS_KEY: storageSecretAccessKey,
    R2_INCOMING_BUCKET: bucketName,
    R2_MEDIA_BUCKET: bucketName,
  })
  .superRefine((env, ctx) => {
    requireProductionNodeEnv(env, ctx);

    const local = env.APP_ENV === 'local';
    if (env.R2_INCOMING_BUCKET === env.R2_MEDIA_BUCKET) {
      ctx.addIssue({
        code: 'custom',
        path: ['R2_MEDIA_BUCKET'],
        message: 'must differ from R2_INCOMING_BUCKET',
      });
    }
    if (!local) {
      const endpoint = parseUrl(env.R2_ENDPOINT);
      if (
        endpoint !== null &&
        (endpoint.protocol !== 'https:' || isLoopbackHost(endpoint.hostname))
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['R2_ENDPOINT'],
          message: 'must be a non-loopback https:// endpoint outside the local environment',
        });
      }
    }
    if (!local) {
      const url = parseUrl(env.WEB_ORIGIN);
      if (url !== null && (url.protocol !== 'https:' || isLoopbackHost(url.hostname))) {
        ctx.addIssue({
          code: 'custom',
          path: ['WEB_ORIGIN'],
          message: 'must be a non-loopback https:// origin outside the local environment',
        });
      }
    }
    if (env.EMAIL_TRANSPORT === 'log' && !local) {
      ctx.addIssue({
        code: 'custom',
        path: ['EMAIL_TRANSPORT'],
        message: 'must be "resend" outside the local environment',
      });
    }
    if (env.EMAIL_TRANSPORT === 'resend' && env.RESEND_API_KEY === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['RESEND_API_KEY'],
        message: 'is required when EMAIL_TRANSPORT is "resend"',
      });
    }
    if (env.PUSH_TRANSPORT === 'log' && !local) {
      ctx.addIssue({
        code: 'custom',
        path: ['PUSH_TRANSPORT'],
        message: 'must be "expo" outside the local environment',
      });
    }
    if (env.PUSH_TRANSPORT === 'expo' && env.EXPO_ACCESS_TOKEN === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['EXPO_ACCESS_TOKEN'],
        message: 'is required when PUSH_TRANSPORT is "expo"',
      });
    }
  });
export type WorkerEnv = z.infer<typeof workerEnvSchema>;
