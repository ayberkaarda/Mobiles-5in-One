import { type Transaction, teams } from '@kadro/db';
import { eq } from 'drizzle-orm';

import { ApiError } from '../errors';
import { type RequestContext } from '../http';
import { type ServerRuntime } from '../runtime';

/** What every team, invite and member service receives from its Route Handler. */
export interface TeamRequest {
  readonly ctx: RequestContext;
  readonly runtime: ServerRuntime;
}

/** The authenticated actor's id. Routes using these services declare `auth: 'required'`. */
export function actorIdOf(ctx: Pick<RequestContext, 'principal'>): string {
  if (ctx.principal === null) {
    throw new ApiError('unauthenticated');
  }
  return ctx.principal.userId;
}

/**
 * Row lock on the team (`SELECT … FOR UPDATE`). Every team mutation takes it before it loads the
 * actor's relationship, so the authorization facts, the state checks and the write all see one
 * consistent membership state: two captaincy transfers, a removal racing a role change, or two
 * invite accepts of one user are serialized (ADR-0008, ADR-0034). A missing team locks nothing;
 * the relationship loader then returns `null` and the caller answers 404.
 */
export async function lockTeam(tx: Transaction, teamId: string): Promise<void> {
  await tx.select({ id: teams.id }).from(teams).where(eq(teams.id, teamId)).for('update');
}
