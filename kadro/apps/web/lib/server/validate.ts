import { LIMITS, type ProblemFieldError } from '@kadro/contracts';
import { z } from 'zod';

import { ApiError } from './errors';

/**
 * Input validation (security checklist item 6, threat model §6.1). Params, query and body of
 * every handler are parsed with a top-level `.strict()` object schema from `@kadro/contracts`;
 * unknown keys, wrong types and out-of-range values become 400 `validation_failed` whose field
 * errors carry only the location and the zod issue code, never the submitted value or key.
 */

export type InputLocation = 'params' | 'query' | 'body' | 'headers';

/** Schema for handlers that accept no path parameters or no query string. */
export const noParams = z.strictObject({});
export const noQuery = z.strictObject({});

/**
 * True for a zod object whose unknown keys are rejected (`z.strictObject` / `.strict()`),
 * including refined objects. Route construction refuses any other top-level schema.
 */
export function isStrictObjectSchema(schema: z.ZodType): boolean {
  return schema instanceof z.ZodObject && schema.def.catchall instanceof z.ZodNever;
}

const SAFE_SEGMENT = /^[A-Za-z0-9_]{1,64}$/;

/** Path segments that are not plain identifiers (record keys chosen by the client) are masked. */
function fieldPath(location: InputLocation, path: readonly PropertyKey[]): string {
  const segments = path.map((segment) => {
    if (typeof segment === 'number') {
      return String(segment);
    }
    return typeof segment === 'string' && SAFE_SEGMENT.test(segment) ? segment : '*';
  });
  return [location, ...segments].join('.').slice(0, 200);
}

const ISSUE_CODE = /^[a-z][a-z_]{0,63}$/;

export function fieldErrors(location: InputLocation, error: z.ZodError): ProblemFieldError[] {
  return error.issues.slice(0, 50).map((issue) => ({
    path: fieldPath(location, issue.path),
    issue: ISSUE_CODE.test(issue.code) ? issue.code : 'invalid',
  }));
}

export function validationError(location: InputLocation, issue: string, path = ''): ApiError {
  const suffix = path === '' ? '' : `.${path}`;
  return new ApiError('validation_failed', {
    errors: [{ path: `${location}${suffix}`, issue }],
  });
}

/** Parses `value` with `schema`; failure → 400 `validation_failed` with value-free field errors. */
export function parseInput<TSchema extends z.ZodType>(
  location: InputLocation,
  schema: TSchema,
  value: unknown,
): z.output<TSchema> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ApiError('validation_failed', { errors: fieldErrors(location, result.error) });
  }
  return result.data;
}

/**
 * Converts a query string to a plain object: a key given once maps to a string, a repeated key
 * to an array of strings (which a scalar schema then rejects).
 */
export function queryToObject(searchParams: URLSearchParams): Record<string, string | string[]> {
  const grouped = new Map<string, string[]>();
  for (const [key, value] of searchParams) {
    const values = grouped.get(key);
    if (values === undefined) {
      grouped.set(key, [value]);
    } else {
      values.push(value);
    }
  }
  return Object.fromEntries(
    [...grouped].map(([key, values]) => [key, values.length === 1 ? (values[0] ?? '') : values]),
  );
}

/** Normalizes Next.js route params (`string | string[]`, possibly absent) to a plain object. */
export function paramsToObject(params: unknown): Record<string, unknown> {
  if (params === null || params === undefined || typeof params !== 'object') {
    return {};
  }
  return Object.fromEntries(Object.entries(params));
}

// ---------------------------------------------------------------------------
// JSON body
// ---------------------------------------------------------------------------

/** `application/json`, optionally with `charset=utf-8` and no other parameter. */
function isJsonMediaType(contentType: string): boolean {
  const [type = '', ...parameters] = contentType
    .split(';')
    .map((part) => part.trim().toLowerCase());
  if (type !== 'application/json' || parameters.length > 1) {
    return false;
  }
  const charset = parameters[0];
  return (
    charset === undefined || charset.replace(/\s+/g, '').replaceAll('"', '') === 'charset=utf-8'
  );
}

async function readLimited(request: Request, maxBytes: number): Promise<Uint8Array> {
  const declared = request.headers.get('content-length');
  if (declared !== null) {
    if (!/^[0-9]{1,15}$/.test(declared.trim())) {
      throw validationError('headers', 'invalid_format', 'content-length');
    }
    if (Number(declared) > maxBytes) {
      throw new ApiError('payload_too_large');
    }
  }
  if (request.body === null) {
    return new Uint8Array(0);
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new ApiError('payload_too_large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * Reads the request body as JSON with the 1 MiB limit of `LIMITS.jsonBodyMaxBytes`.
 * - more than the limit (declared or streamed) → 413 `payload_too_large`;
 * - a non-empty body that is not `application/json` → 415 `unsupported_media_type`;
 * - invalid UTF-8 or JSON → 400 `validation_failed`.
 * An empty body yields `undefined`, which every object schema rejects. The raw bytes are returned
 * with the value for handlers that hash the exact payload (`webhooks/revenuecat`).
 */
export async function readJsonBodyWithBytes(
  request: Request,
  maxBytes: number = LIMITS.jsonBodyMaxBytes,
): Promise<{ readonly value: unknown; readonly bytes: Uint8Array }> {
  const bytes = await readLimited(request, maxBytes);
  if (bytes.byteLength === 0) {
    return { value: undefined, bytes };
  }
  const contentType = request.headers.get('content-type');
  if (contentType === null || !isJsonMediaType(contentType)) {
    throw new ApiError('unsupported_media_type');
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    throw validationError('body', 'invalid_encoding');
  }
  try {
    return { value: JSON.parse(text) as unknown, bytes };
  } catch {
    throw validationError('body', 'invalid_json');
  }
}

/** Rejects a non-empty body on an operation that accepts none. */
export async function assertNoBody(request: Request): Promise<void> {
  const bytes = await readLimited(request, LIMITS.jsonBodyMaxBytes);
  if (bytes.byteLength > 0) {
    throw validationError('body', 'unexpected_body');
  }
}
