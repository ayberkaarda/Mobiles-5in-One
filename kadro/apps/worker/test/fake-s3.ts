import { createHash } from 'node:crypto';
import { type IncomingMessage, type ServerResponse } from 'node:http';

/**
 * Minimal in-memory S3 API (path style) for tests: HEAD, GET (with Range), PUT and DELETE of
 * objects and ListObjectsV2. Every operation is recorded in order, and a fault hook can fail
 * chosen operations to exercise retries. Signatures are not verified.
 */

export const TEST_INCOMING_BUCKET = 'kadro-test-incoming';
export const TEST_MEDIA_BUCKET = 'kadro-test-media';
export const TEST_BUCKETS = [TEST_INCOMING_BUCKET, TEST_MEDIA_BUCKET] as const;

export interface FakeObject {
  readonly body: Buffer;
  readonly contentType: string | undefined;
  readonly cacheControl: string | undefined;
  lastModified: Date;
}

export interface S3Operation {
  readonly method: string;
  readonly bucket: string;
  readonly key: string;
  readonly at: number;
}

/** Return an HTTP status to fail the operation, or `undefined` to serve it normally. */
export type S3Fault = (operation: S3Operation) => number | undefined;

export class FakeS3 {
  readonly buckets = new Map<string, Map<string, FakeObject>>(
    TEST_BUCKETS.map((name) => [name, new Map<string, FakeObject>()]),
  );
  readonly operations: S3Operation[] = [];
  fault: S3Fault | undefined;
  /** Runs before an operation is served; awaited, so it can delay or interleave other work. */
  before: ((operation: S3Operation) => Promise<void> | void) | undefined;
  /** Replaces the bytes a GET returns (HEAD still reports the stored size). */
  readOverride: ((operation: S3Operation, body: Buffer) => Buffer) | undefined;

  bucket(name: string): Map<string, FakeObject> {
    const bucket = this.buckets.get(name);
    if (bucket === undefined) {
      throw new Error(`unknown test bucket ${name}`);
    }
    return bucket;
  }

  putObject(bucket: string, key: string, body: Buffer, lastModified = new Date()): void {
    this.bucket(bucket).set(key, {
      body,
      contentType: undefined,
      cacheControl: undefined,
      lastModified,
    });
  }

  object(bucket: string, key: string): FakeObject | undefined {
    return this.bucket(bucket).get(key);
  }

  keys(bucket: string, prefix = ''): string[] {
    return [...this.bucket(bucket).keys()].filter((key) => key.startsWith(prefix)).sort();
  }

  handles(path: string): boolean {
    return TEST_BUCKETS.some(
      (name) => path === `/${name}` || path.startsWith(`/${name}/`) || path.startsWith(`/${name}?`),
    );
  }

  async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://fake-s3');
    const [, bucketName = '', ...rest] = url.pathname.split('/');
    const key = rest.map((segment) => decodeURIComponent(segment)).join('/');
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(chunk as Buffer);
    }
    const body = Buffer.concat(chunks);
    const method = request.method ?? 'GET';
    const isList = method === 'GET' && key === '' && url.searchParams.get('list-type') === '2';
    const operation: S3Operation = {
      method: isList ? 'LIST' : method,
      bucket: bucketName,
      key: isList ? (url.searchParams.get('prefix') ?? '') : key,
      at: performance.now(),
    };
    this.operations.push(operation);

    await this.before?.(operation);
    const failure = this.fault?.(operation);
    if (failure !== undefined) {
      this.error(response, failure, 'InternalError');
      return;
    }
    const bucket = this.buckets.get(bucketName);
    if (bucket === undefined) {
      this.error(response, 404, 'NoSuchBucket');
      return;
    }

    if (isList) {
      this.list(response, bucketName, bucket, url.searchParams);
      return;
    }
    const stored = bucket.get(key);
    switch (method) {
      case 'PUT': {
        bucket.set(key, {
          body,
          contentType: request.headers['content-type'],
          cacheControl: request.headers['cache-control'] as string | undefined,
          lastModified: new Date(),
        });
        response.writeHead(200, { etag: `"${createHash('md5').update(body).digest('hex')}"` });
        response.end();
        return;
      }
      case 'DELETE':
        bucket.delete(key);
        response.writeHead(204);
        response.end();
        return;
      case 'HEAD':
        if (stored === undefined) {
          response.writeHead(404);
          response.end();
          return;
        }
        response.writeHead(200, {
          'content-length': String(stored.body.length),
          'last-modified': stored.lastModified.toUTCString(),
          'content-type': stored.contentType ?? 'application/octet-stream',
        });
        response.end();
        return;
      case 'GET': {
        if (stored === undefined) {
          this.error(response, 404, 'NoSuchKey');
          return;
        }
        const served = this.readOverride?.(operation, stored.body) ?? stored.body;
        const range = /^bytes=(\d{1,12})-(\d{0,12})$/.exec(request.headers.range ?? '');
        if (range) {
          const start = Number(range[1]);
          const end = Math.min(range[2] ? Number(range[2]) : served.length - 1, served.length - 1);
          const slice = served.subarray(start, end + 1);
          response.writeHead(206, {
            'content-length': String(slice.length),
            'content-range': `bytes ${start}-${end}/${served.length}`,
          });
          response.end(slice);
          return;
        }
        response.writeHead(200, { 'content-length': String(served.length) });
        response.end(served);
        return;
      }
      default:
        this.error(response, 405, 'MethodNotAllowed');
    }
  }

  private list(
    response: ServerResponse,
    bucketName: string,
    bucket: Map<string, FakeObject>,
    params: URLSearchParams,
  ): void {
    const prefix = params.get('prefix') ?? '';
    const max = Number(params.get('max-keys') ?? '1000');
    const after = params.get('continuation-token') ?? '';
    const keys = [...bucket.keys()].filter((key) => key.startsWith(prefix) && key > after).sort();
    const page = keys.slice(0, max);
    const truncated = keys.length > page.length;
    const escape = (value: string): string =>
      value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const contents = page
      .map((key) => {
        const object = bucket.get(key);
        return `<Contents><Key>${escape(key)}</Key><LastModified>${(object?.lastModified ?? new Date()).toISOString()}</LastModified><ETag>"0"</ETag><Size>${object?.body.length ?? 0}</Size><StorageClass>STANDARD</StorageClass></Contents>`;
      })
      .join('');
    const next = truncated
      ? `<NextContinuationToken>${escape(page.at(-1) ?? '')}</NextContinuationToken>`
      : '';
    const xml = `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>${bucketName}</Name><Prefix>${escape(prefix)}</Prefix><KeyCount>${page.length}</KeyCount><MaxKeys>${max}</MaxKeys><IsTruncated>${truncated}</IsTruncated>${contents}${next}</ListBucketResult>`;
    response.writeHead(200, { 'content-type': 'application/xml' });
    response.end(xml);
  }

  private error(response: ServerResponse, status: number, code: string): void {
    response.writeHead(status, { 'content-type': 'application/xml' });
    response.end(
      `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${code}</Message></Error>`,
    );
  }
}
