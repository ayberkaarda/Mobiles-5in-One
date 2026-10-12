import { inject, Injectable } from '@angular/core';
import { HealthStatus, isHealthStatus } from '@inecekvar/domain';
import { ApiError } from './api-error';
import { API_BASE_URL, API_CLIENT_OPTIONS, FETCH } from './config';
import { newRequestId, readJson, REQUEST_ID_HEADER, send } from './http';

@Injectable({ providedIn: 'root' })
export class HealthClient {
  private readonly baseUrl = inject(API_BASE_URL);
  private readonly fetchFn = inject(FETCH);
  private readonly options = inject(API_CLIENT_OPTIONS);

  async check(): Promise<HealthStatus> {
    const requestId = newRequestId();
    return send(
      this.fetchFn,
      `${this.baseUrl}/health`,
      { headers: { Accept: 'application/json', [REQUEST_ID_HEADER]: requestId } },
      { timeoutMs: this.options.timeoutMs, requestId },
      async (response) => {
        if (!response.ok) {
          throw await ApiError.fromResponse(response, requestId, this.options.now());
        }
        const body = await readJson(response, requestId);
        if (!isHealthStatus(body)) {
          throw new ApiError('invalid_response', response.status, 'unexpected body', requestId);
        }
        return body;
      },
    );
  }
}
