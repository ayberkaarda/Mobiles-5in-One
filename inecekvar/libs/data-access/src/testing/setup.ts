import { TestBed } from '@angular/core/testing';
import { API_CLIENT_OPTIONS, FETCH, IS_NATIVE_PLATFORM } from '../lib/config';
import { SECURE_TOKEN_STORE } from '../lib/auth/secure-token-store';
import { PENDING_LOGOUT_MARKER, type PendingLogoutMarker } from '../lib/auth/pending-logout-marker';
import { provideDataAccess } from '../lib/provide-data-access';
import { FakeFetch, MemoryTokenStore, TEST_API } from './fake-fetch';

export interface Harness {
  fake: FakeFetch;
  store: MemoryTokenStore;
  clock: { now: number };
  sleeps: number[];
  marker: PendingLogoutMarker;
}

/** Configures TestBed with the real providers, a fake fetch, a fake clock and no sleeping. */
export function setupDataAccess(native: boolean, timeoutMs = 1_000): Harness {
  let pending = false;
  const harness: Harness = {
    fake: new FakeFetch(),
    store: new MemoryTokenStore(),
    clock: { now: Date.parse('2026-10-12T10:00:00Z') },
    sleeps: [],
    marker: {
      isSet: () => pending,
      set: () => {
        pending = true;
      },
      clear: () => {
        pending = false;
      },
    },
  };
  TestBed.configureTestingModule({
    providers: [
      provideDataAccess({ apiBase: TEST_API, tilesBase: 'https://tiles.test' }),
      { provide: IS_NATIVE_PLATFORM, useValue: native },
      { provide: SECURE_TOKEN_STORE, useValue: harness.store },
      { provide: PENDING_LOGOUT_MARKER, useValue: harness.marker },
      { provide: FETCH, useValue: harness.fake.fn },
      {
        provide: API_CLIENT_OPTIONS,
        useValue: {
          timeoutMs,
          maxAutoRetryAfterSeconds: 5,
          sleep: async (ms: number) => {
            harness.sleeps.push(ms);
          },
          now: () => harness.clock.now,
        },
      },
    ],
  });
  return harness;
}
