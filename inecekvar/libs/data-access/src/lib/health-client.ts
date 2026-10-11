import { inject, Injectable, InjectionToken } from '@angular/core';
import { HealthStatus, isHealthStatus } from '@inecekvar/domain';

/** Base URL of the API including the version prefix, for example `https://api.inecekvar.app/v1`. */
export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL');

/** Fetch implementation used by the clients; tests replace it. */
export const FETCH = new InjectionToken<typeof fetch>('FETCH', {
  providedIn: 'root',
  factory: () => globalThis.fetch.bind(globalThis),
});

@Injectable({ providedIn: 'root' })
export class HealthClient {
  private readonly baseUrl = inject(API_BASE_URL);
  private readonly fetchFn = inject(FETCH);

  async check(): Promise<HealthStatus> {
    const response = await this.fetchFn(`${this.baseUrl}/health`, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`health check failed with HTTP ${response.status}`);
    }
    const body: unknown = await response.json();
    if (!isHealthStatus(body)) {
      throw new Error('health check returned an unexpected body');
    }
    return body;
  }
}
