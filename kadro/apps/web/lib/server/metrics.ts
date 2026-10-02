/**
 * Operational counters of the API process. Each increment is also emitted as a structured log
 * line carrying `metric: <name>` by the caller, which is what the log-based alert rules count
 * (ADR-0022: any non-zero `client_ip_missing` over 5 minutes in preview / production alerts).
 * The in-process totals serve tests and a future metrics endpoint.
 */
export const METRIC_NAMES = [
  'client_ip_missing',
  // ADR-0018: the alert compares unavailable breach checks with all checks over 15 minutes.
  'password_breach_check',
  'password_breach_check_unavailable',
  // Provider JWKS refresh failing: expired keys still served (bounded), then dropped.
  'jwks_stale_keys',
  'jwks_keys_expired',
] as const;
export type MetricName = (typeof METRIC_NAMES)[number];

export interface Metrics {
  increment(name: MetricName): void;
  value(name: MetricName): number;
}

export function createMetrics(): Metrics {
  const counters = new Map<MetricName, number>();
  return {
    increment(name) {
      counters.set(name, (counters.get(name) ?? 0) + 1);
    },
    value(name) {
      return counters.get(name) ?? 0;
    },
  };
}
