import { RATE_LIMIT_GROUPS, type RateLimitGroup } from '@kadro/contracts';

import { ApiError } from './errors';
import { type ServerRuntime } from './runtime';

/**
 * Endpoint-group rate limits of authorization matrix §8, applied by `route()` from the
 * registry's `rateLimit` field (step 3 of the handler template, after validation). Limits and key
 * kinds come from `RATE_LIMIT_GROUPS`. Keys are keyed hashes (`HASH_SECRET`, ADR-0023):
 * `group:<G>:user:<hash>` and `group:<G>:ip:<hash>`, so a group (G above all) is one budget per
 * user across every endpoint that declares it.
 *
 * A `user+ip` group charges the user and the address together or not at all; an anonymous caller
 * (optional-auth reads such as the invite preview) is counted by address only. Groups A and R
 * have their own subjects (IP + email, refresh family) and are enforced by the auth endpoints.
 */

/** Groups `route()` can apply: those keyed by user, or by user and address. */
export type EndpointLimitGroup = {
  [G in RateLimitGroup]: (typeof RATE_LIMIT_GROUPS)[G]['key'] extends 'user' | 'user+ip'
    ? G
    : never;
}[RateLimitGroup];

export function isEndpointLimitGroup(group: RateLimitGroup): group is EndpointLimitGroup {
  // eslint-disable-next-line security/detect-object-injection -- group is a typed RateLimitGroup key
  const { key } = RATE_LIMIT_GROUPS[group];
  return key === 'user' || key === 'user+ip';
}

/** Whether the group can count an anonymous caller (by address). */
export function allowsAnonymous(group: EndpointLimitGroup): boolean {
  // eslint-disable-next-line security/detect-object-injection -- group is a typed RateLimitGroup key
  return RATE_LIMIT_GROUPS[group].key === 'user+ip';
}

export interface GroupLimitSubject {
  readonly userId: string | null;
  /** `ctx.ipSubject`: the trusted client address, `unknown` when the proxy header is missing. */
  readonly ipSubject: string;
}

/** Bucket keys charged for one request of `group`. */
export function groupLimitKeys(
  runtime: Pick<ServerRuntime, 'keyedHash'>,
  group: EndpointLimitGroup,
  subject: GroupLimitSubject,
): string[] {
  const userKey =
    subject.userId === null
      ? null
      : `group:${group}:user:${runtime.keyedHash('rate-limit', subject.userId)}`;
  const ipKey = `group:${group}:ip:${runtime.keyedHash('rate-limit', subject.ipSubject)}`;
  if (allowsAnonymous(group)) {
    return userKey === null ? [ipKey] : [userKey, ipKey];
  }
  if (userKey === null) {
    throw new TypeError(`rate-limit group ${group} needs an authenticated user`);
  }
  return [userKey];
}

/** Counts the request against `group`; 429 `rate_limited` with `Retry-After` when exhausted. */
export async function enforceEndpointGroup(
  runtime: Pick<ServerRuntime, 'keyedHash' | 'limiter'>,
  group: EndpointLimitGroup,
  subject: GroupLimitSubject,
): Promise<void> {
  // eslint-disable-next-line security/detect-object-injection -- group is a typed RateLimitGroup key
  const rule = RATE_LIMIT_GROUPS[group];
  const result = await runtime.limiter.hitAll(groupLimitKeys(runtime, group, subject), {
    max: rule.max,
    windowSeconds: rule.windowSeconds,
  });
  if (!result.allowed) {
    throw new ApiError('rate_limited', {
      headers: { 'Retry-After': String(result.retryAfterSeconds) },
    });
  }
}
