import { PLATFORM_ID, RESPONSE_INIT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PageStatus } from './page-status';

afterEach(() => TestBed.resetTestingModule());

function setup(platform: 'server' | 'browser', response: ResponseInit | null) {
  TestBed.configureTestingModule({
    providers: [
      { provide: PLATFORM_ID, useValue: platform },
      { provide: RESPONSE_INIT, useValue: response },
    ],
  });
  return TestBed.inject(PageStatus);
}

describe('page status', () => {
  it('marks a missing server page', () => {
    const response: ResponseInit = {};
    setup('server', response).notFound();
    expect(response.status).toBe(404);
  });

  it('marks an unavailable server page and preserves other headers', () => {
    const response: ResponseInit = { headers: { 'X-Test': 'kept' } };
    setup('server', response).unavailable();
    expect(response.status).toBe(503);
    expect(new Headers(response.headers).get('Retry-After')).toBe('120');
    expect(new Headers(response.headers).get('X-Test')).toBe('kept');
  });

  it('leaves a provided response untouched in the browser', () => {
    const response: ResponseInit = { status: 200 };
    const service = setup('browser', response);
    service.notFound();
    service.unavailable();
    expect(response).toEqual({ status: 200 });
  });

  it('handles a server context without a response object', () => {
    const service = setup('server', null);
    expect(() => service.notFound()).not.toThrow();
    expect(() => service.unavailable()).not.toThrow();
  });
});
