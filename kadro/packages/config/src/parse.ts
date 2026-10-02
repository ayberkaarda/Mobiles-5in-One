import type { z } from 'zod';

import type { EnvSource } from './shared.js';

export interface EnvIssue {
  readonly key: string;
  readonly message: string;
}

/**
 * Raised when configuration is missing or invalid. The message lists offending keys and the
 * rule they broke, never the values themselves, so it is safe to log at boot.
 */
export class EnvValidationError extends Error {
  readonly issues: readonly EnvIssue[];

  constructor(scope: string, issues: readonly EnvIssue[]) {
    const lines = issues.map((issue) => `  - ${issue.key}: ${issue.message}`);
    super(`Invalid ${scope} configuration:\n${lines.join('\n')}`);
    this.name = 'EnvValidationError';
    this.issues = issues;
  }
}

export function parseEnv<TSchema extends z.ZodType>(
  scope: string,
  schema: TSchema,
  source: EnvSource,
): z.infer<TSchema> {
  // An empty value (`KEY=` in a .env file) is treated exactly like an unset key.
  const normalized = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value !== ''),
  );
  const result = schema.safeParse(normalized);
  if (result.success) {
    return result.data;
  }
  const issues = result.error.issues.map((issue) => {
    const key = issue.path.length > 0 ? issue.path.map(String).join('.') : '(root)';
    const missing = issue.path.length === 1 && !Object.hasOwn(normalized, key);
    return { key, message: missing ? 'is required' : issue.message };
  });
  throw new EnvValidationError(scope, issues);
}
