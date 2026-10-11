/** Body of `GET /v1/health`; the endpoint returns no further details (spec section 8). */
export interface HealthStatus {
  status: 'ok';
}

export function isHealthStatus(value: unknown): value is HealthStatus {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.keys(value).length === 1 &&
    (value as { status?: unknown }).status === 'ok'
  );
}
