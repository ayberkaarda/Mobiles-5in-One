import { TestBed } from '@angular/core/testing';
import { setupDataAccess } from '../testing/setup';
import { ApiError } from './api-error';
import type { PresignedUpload } from './api-types';
import { FETCH } from './config';
import { ContributionApi } from './endpoints';

interface Sent {
  url: string;
  init: RequestInit;
}

function presigned(size: number, overrides: Partial<PresignedUpload> = {}): PresignedUpload {
  return {
    photo_id: '01920000-0000-7000-8000-0000000000aa',
    upload_url: 'https://storage.test/incoming/abc?X-Amz-Signature=sig',
    method: 'PUT',
    headers: { 'Content-Type': 'image/jpeg', 'Content-Length': String(size) },
    expires_in: 300,
    ...overrides,
  };
}

function setup(answer: (sent: Sent) => Response | Promise<Response>) {
  setupDataAccess(false, 1_000);
  const sent: Sent[] = [];
  TestBed.overrideProvider(FETCH, {
    useValue: (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const call = { url: String(input), init };
      sent.push(call);
      return answer(call);
    }) as typeof fetch,
  });
  return { api: TestBed.inject(ContributionApi), sent };
}

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('expected the upload to fail');
}

describe('ContributionApi.uploadPhoto', () => {
  const photo = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])], {
    type: 'image/jpeg',
  });

  it('PUTs the bytes to the presigned URL with only the signed headers and no credential', async () => {
    const { api, sent } = setup(() => new Response(null, { status: 200 }));
    await api.uploadPhoto(presigned(photo.size), photo);
    expect(sent).toHaveLength(1);
    const [call] = sent;
    expect(call?.url).toBe('https://storage.test/incoming/abc?X-Amz-Signature=sig');
    expect(call?.init.method).toBe('PUT');
    expect(call?.init.credentials).toBe('omit');
    expect(call?.init.body).toBe(photo);
    const headers = new Headers(call?.init.headers);
    expect(headers.get('Content-Type')).toBe('image/jpeg');
    // The browser derives the length from the body; a page cannot set it.
    expect(headers.has('Content-Length')).toBe(false);
    expect(headers.has('Authorization')).toBe(false);
    expect(headers.has('X-CSRF-Token')).toBe(false);
    expect(headers.has('X-Request-ID')).toBe(false);
  });

  it('refuses to send when the signed length differs from the body', async () => {
    const { api, sent } = setup(() => new Response(null, { status: 200 }));
    const error = await failure(api.uploadPhoto(presigned(photo.size + 1), photo));
    expect(error.code).toBe('upload.length_mismatch');
    expect(sent).toHaveLength(0);
  });

  it('refuses a non-http upload URL', async () => {
    const { api, sent } = setup(() => new Response(null, { status: 200 }));
    const error = await failure(
      api.uploadPhoto(presigned(photo.size, { upload_url: 'javascript:alert(1)' }), photo),
    );
    expect(error.code).toBe('upload.bad_url');
    expect(sent).toHaveLength(0);
  });

  it('reports a refused upload (expired signature, wrong size) with its status', async () => {
    const { api } = setup(() => new Response('<Error/>', { status: 403 }));
    const error = await failure(api.uploadPhoto(presigned(photo.size), photo));
    expect(error.kind).toBe('http');
    expect(error.status).toBe(403);
    expect(error.code).toBe('upload.403');
  });

  it('reports a dropped connection as a network error', async () => {
    const { api } = setup(() => Promise.reject(new TypeError('Failed to fetch')));
    const error = await failure(api.uploadPhoto(presigned(photo.size), photo));
    expect(error.kind).toBe('network');
  });
});
