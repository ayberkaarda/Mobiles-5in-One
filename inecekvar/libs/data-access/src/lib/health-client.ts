import { inject, Injectable } from '@angular/core';
import { HealthStatus, isHealthStatus } from '@inecekvar/domain';
import { API_BASE_URL, FETCH } from './config';

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
