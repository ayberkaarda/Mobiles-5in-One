import { type Logger } from 'pino';

/**
 * Worker metrics are structured log lines with a `metric` field (docs/ops/worker.md). Labels are
 * queue names, kinds, outcomes and provider error codes only, never personal data.
 */
export const METRIC_NAMES = [
  'job_completed',
  'job_failed',
  'job_dead_lettered',
  'email_delivery_failed',
  'email_stale_dropped',
  'push_capped',
  'push_ticket_error',
  'push_receipt_error',
  'cost_threshold',
  'cost_capped',
  'cost_guard_failed',
] as const;
export type MetricName = (typeof METRIC_NAMES)[number];

export type MetricLabels = Readonly<Record<string, string | number>>;

export interface Metrics {
  increment(name: MetricName, labels: MetricLabels): void;
}

/** Metrics that alert in preview and production are written at `warn` or `error`. */
const LEVELS: Readonly<Record<MetricName, 'info' | 'warn' | 'error'>> = {
  job_completed: 'info',
  job_failed: 'warn',
  job_dead_lettered: 'error',
  email_delivery_failed: 'warn',
  email_stale_dropped: 'info',
  push_capped: 'warn',
  push_ticket_error: 'warn',
  push_receipt_error: 'warn',
  cost_threshold: 'warn',
  cost_capped: 'info',
  cost_guard_failed: 'error',
};

export function createLogMetrics(logger: Logger): Metrics {
  return {
    increment(name, labels) {
      // eslint-disable-next-line security/detect-object-injection -- name is a typed MetricName key
      logger[LEVELS[name]]({ metric: name, ...labels }, name);
    },
  };
}
