import { createHash, createHmac, randomBytes } from 'node:crypto';

import { createDbClient, type DbClient, districts } from '@kadro/db';

import { type RouteHandler } from '../../lib/server/http';
import { createMigratedDatabase } from '../support/db';
import { call } from '../support/http';
import { bootstrapJobQueues, createRoleLogins, type RoleLogins } from '../support/jobs';
import { installTestRuntime } from '../support/runtime';
import { type TeamsHarness } from '../teams/support';
import { POST as presignRoute } from '../../app/api/v1/uploads/presign/route';
import { GET as getUploadRoute } from '../../app/api/v1/uploads/[id]/route';
import { POST as completeRoute } from '../../app/api/v1/uploads/[id]/complete/route';
import { POST as pushTokenRoute } from '../../app/api/v1/me/push-tokens/route';

/**
 * Shared fixtures of the upload and push-token suites: a disposable migrated PostgreSQL + PostGIS
 * database with the worker's job queues, the API running as a `kadro_app` login, and upload
 * storage configured with credentials generated at run time. Presigning is local computation;
 * nothing in these suites talks to object storage or any other network service.
 */

export const STORAGE_ENDPOINT = 'https://storage.kadro.test';
export const INCOMING_BUCKET = 'kadro-uploads-incoming';
export const MEDIA_BASE_URL = 'https://media.kadro.test';

export interface StorageCredentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

export interface UploadsHarness extends TeamsHarness {
  readonly logins: RoleLogins;
  readonly app: DbClient;
  readonly storage: StorageCredentials;
  dispose(): Promise<void>;
}

export async function setupUploadsHarness(
  prefix: string,
  env: Readonly<Record<string, string>> = {},
): Promise<UploadsHarness> {
  const database = await createMigratedDatabase(prefix);
  await bootstrapJobQueues(database.url);
  const logins = await createRoleLogins(database.url);
  const app = createDbClient({ connectionString: logins.appUrl, maxConnections: 20 });
  const storage: StorageCredentials = {
    accessKeyId: randomBytes(10).toString('hex').toUpperCase(),
    secretAccessKey: randomBytes(30).toString('base64url'),
  };
  const harness = await installTestRuntime({
    db: app.db,
    env: {
      DATABASE_URL: logins.appUrl,
      R2_ENDPOINT: STORAGE_ENDPOINT,
      R2_ACCESS_KEY_ID: storage.accessKeyId,
      R2_SECRET_ACCESS_KEY: storage.secretAccessKey,
      R2_INCOMING_BUCKET: INCOMING_BUCKET,
      MEDIA_PUBLIC_BASE_URL: MEDIA_BASE_URL,
      ...env,
    },
  });
  const [district] = await database.client.db
    .insert(districts)
    .values({
      il: 'İstanbul',
      ilce: 'Kadıköy',
      ilSlug: 'istanbul',
      slug: 'kadikoy',
      centroid: { lng: 29.03, lat: 40.99 },
    })
    .returning({ id: districts.id });
  return {
    database,
    db: database.client.db,
    harness,
    logins,
    app,
    storage,
    districtId: district?.id ?? '',
    otherDistrictId: district?.id ?? '',
    dispose: async () => {
      await harness.runtime.jobClient.close();
      await app.close();
      await logins.drop();
      await database.dispose();
    },
  };
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

function request(
  handler: RouteHandler,
  method: string,
  pattern: string,
  options: { headers: Record<string, string>; params?: Record<string, string>; json?: unknown },
): Promise<Response> {
  let pathname = pattern;
  for (const [name, value] of Object.entries(options.params ?? {})) {
    pathname = pathname.replace(`[${name}]`, encodeURIComponent(value));
  }
  return call(handler, {
    method,
    path: pathname,
    headers: options.headers,
    ...(options.json === undefined ? {} : { json: options.json }),
    ...(options.params === undefined ? {} : { params: options.params }),
  });
}

export const uploadsApi = {
  presign: (headers: Record<string, string>, json: unknown) =>
    request(presignRoute, 'POST', '/api/v1/uploads/presign', { headers, json }),
  complete: (headers: Record<string, string>, id: string, json: unknown = {}) =>
    request(completeRoute, 'POST', '/api/v1/uploads/[id]/complete', {
      headers,
      params: { id },
      json,
    }),
  get: (headers: Record<string, string>, id: string) =>
    request(getUploadRoute, 'GET', '/api/v1/uploads/[id]', { headers, params: { id } }),
  registerPushToken: (headers: Record<string, string>, json: unknown) =>
    request(pushTokenRoute, 'POST', '/api/v1/me/push-tokens', { headers, json }),
};

/** An Expo push token generated at run time. */
export function expoToken(prefix: 'ExponentPushToken' | 'ExpoPushToken' = 'ExponentPushToken') {
  return `${prefix}[${randomBytes(16).toString('base64url')}]`;
}

// ---------------------------------------------------------------------------
// Local SigV4 verification of presigned URLs
// ---------------------------------------------------------------------------

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest();
}

/** RFC 3986 encoding as SigV4 requires it for query keys and values. */
function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export interface PresignedPut {
  readonly url: URL;
  readonly signedHeaders: string[];
  readonly expiresSeconds: number;
  readonly signedAt: Date;
  readonly credentialScope: string;
  readonly signature: string;
}

export function parsePresignedPut(value: string): PresignedPut {
  const url = new URL(value);
  const params = url.searchParams;
  const amzDate = params.get('X-Amz-Date') ?? '';
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(amzDate);
  if (match === null) {
    throw new Error('presigned URL without X-Amz-Date');
  }
  const [, year, month, day, hour, minute, second] = match;
  const credential = params.get('X-Amz-Credential') ?? '';
  return {
    url,
    signedHeaders: (params.get('X-Amz-SignedHeaders') ?? '').split(';'),
    expiresSeconds: Number(params.get('X-Amz-Expires')),
    signedAt: new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`),
    credentialScope: credential.split('/').slice(1).join('/'),
    signature: params.get('X-Amz-Signature') ?? '',
  };
}

/**
 * Recomputes the SigV4 query signature of a presigned PUT the way object storage does when the
 * request arrives with `headers` (lower-case names), and reports whether it matches. A request
 * whose signed headers differ from what was signed (another length or type) fails.
 */
export function signatureMatches(
  presigned: PresignedPut,
  secretAccessKey: string,
  headers: Readonly<Record<string, string>>,
): boolean {
  const { url } = presigned;
  const query = [...url.searchParams.entries()]
    .filter(([name]) => name !== 'X-Amz-Signature')
    .map(([name, value]) => [encodeRfc3986(name), encodeRfc3986(value)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, value]) => `${name}=${value}`)
    .join('&');
  const allHeaders = new Map(Object.entries({ host: url.host, ...headers }));
  const canonicalHeaders = presigned.signedHeaders
    .map((name) => `${name}:${(allHeaders.get(name) ?? '').trim()}\n`)
    .join('');
  const canonicalRequest = [
    'PUT',
    url.pathname,
    query,
    canonicalHeaders,
    presigned.signedHeaders.join(';'),
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const amzDate = url.searchParams.get('X-Amz-Date') ?? '';
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    presigned.credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');
  const [date = '', region = '', service = ''] = presigned.credentialScope.split('/');
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${secretAccessKey}`, date), region), service),
    'aws4_request',
  );
  const expected = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
  return expected === presigned.signature;
}
