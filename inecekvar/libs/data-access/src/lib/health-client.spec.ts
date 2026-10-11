import { TestBed } from '@angular/core/testing';
import { API_BASE_URL, FETCH, HealthClient } from './health-client';

function setup(response: Response): { client: HealthClient; calls: string[] } {
  const calls: string[] = [];
  const fakeFetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return response;
  }) as typeof fetch;
  TestBed.configureTestingModule({
    providers: [
      { provide: API_BASE_URL, useValue: 'http://localhost:57800/v1' },
      { provide: FETCH, useValue: fakeFetch },
    ],
  });
  return { client: TestBed.inject(HealthClient), calls };
}

describe('HealthClient', () => {
  it('reads the health body from the versioned endpoint', async () => {
    const { client, calls } = setup(Response.json({ status: 'ok' }));
    await expect(client.check()).resolves.toEqual({ status: 'ok' });
    expect(calls).toEqual(['http://localhost:57800/v1/health']);
  });

  it('rejects a non-2xx response', async () => {
    const { client } = setup(new Response('', { status: 503 }));
    await expect(client.check()).rejects.toThrow('HTTP 503');
  });

  it('rejects a body with extra fields', async () => {
    const { client } = setup(Response.json({ status: 'ok', db: 'up' }));
    await expect(client.check()).rejects.toThrow('unexpected body');
  });
});
