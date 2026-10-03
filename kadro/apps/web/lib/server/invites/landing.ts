import { ENDPOINTS, inviteCodeSchema } from '@kadro/contracts';
import { districts } from '@kadro/db';
import { eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { cache } from 'react';

import { AuthorizationGate } from '../authorize';
import { rateLimitSubject } from '../client-ip';
import { ApiError } from '../errors';
import { enforceEndpointGroup } from '../group-limits';
import { type RequestContext } from '../http';
import { resolveRequestId } from '../request-context';
import { type ServerRuntime, serverRuntime } from '../runtime';
import { previewInvite } from '../teams/invites';

/**
 * Data of the invite landing page `/mac/<code>` (product spec §7, ADR-0034, ADR-0058).
 *
 * The page shows exactly what the anonymous preview endpoint `GET invites/:code` returns, through
 * the same service and the same rules:
 * - a malformed code is a 404 without a query; an unknown, expired, revoked or exhausted code is
 *   the same 404 after one indexed lookup (`previewInvite`), so the page tells a prober nothing
 *   the API does not;
 * - every lookup is charged to rate limit group I by client address, the budget the preview
 *   endpoint uses, so the page is no cheaper way to probe codes;
 * - only the team name, its district and the member count leave the server; no member or
 *   captain name, no email and no badge image (a media URL would be a third-party resource on a
 *   page that must have none, ADR-0034);
 * - nothing is cached: an invite is a bearer secret and can be revoked at any time.
 */

export interface InviteLandingTeam {
  readonly name: string;
  /** District names, or `null` if the district row is gone. */
  readonly district: { readonly il: string; readonly ilce: string } | null;
  readonly memberCount: number;
}

export type InviteLanding =
  | { readonly state: 'found'; readonly code: string; readonly team: InviteLandingTeam }
  | { readonly state: 'not-found' }
  | { readonly state: 'rate-limited' };

/** Anonymous request context for the preview service (no session is read on this page). */
function anonymousContext(
  runtime: ServerRuntime,
  requestHeaders: Headers,
  ip: string | null,
): RequestContext {
  const gate = new AuthorizationGate(runtime, null);
  const requestId = resolveRequestId(requestHeaders);
  return {
    requestId,
    client: null,
    ip,
    ipSubject: rateLimitSubject(ip),
    principal: null,
    logger: runtime.logger.child({ requestId }),
    authorize: (action, resource) => gate.authorize(action, resource),
    authAttempts: null,
  };
}

/**
 * The landing data for a path segment. React `cache` shares one result between
 * `generateMetadata` and the page, so a request is charged to group I once.
 */
export const loadInviteLanding = cache(async (rawCode: string): Promise<InviteLanding> => {
  const parsed = inviteCodeSchema.safeParse(rawCode);
  if (!parsed.success) {
    return { state: 'not-found' };
  }
  const code = parsed.data;
  const runtime = await serverRuntime();
  const requestHeaders = new Headers(await headers());
  const ip = runtime.clientIp.resolve(requestHeaders);
  const ctx = anonymousContext(runtime, requestHeaders, ip);
  try {
    await enforceEndpointGroup(runtime, ENDPOINTS.previewInvite.rateLimit, {
      userId: null,
      ipSubject: ctx.ipSubject,
    });
    const { team } = await previewInvite({ ctx, runtime }, code);
    const [district] = await runtime.db
      .select({ il: districts.il, ilce: districts.ilce })
      .from(districts)
      .where(eq(districts.id, team.districtId))
      .limit(1);
    return {
      state: 'found',
      code,
      team: { name: team.name, district: district ?? null, memberCount: team.memberCount },
    };
  } catch (error) {
    if (error instanceof ApiError && error.code === 'not_found') {
      return { state: 'not-found' };
    }
    if (error instanceof ApiError && error.code === 'rate_limited') {
      return { state: 'rate-limited' };
    }
    throw error;
  }
});
