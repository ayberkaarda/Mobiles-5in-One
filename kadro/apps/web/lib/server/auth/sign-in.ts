import { hashPassword, passwordNeedsRehash, verifyPassword } from '@kadro/auth';
import { type AuthClient, displayNameSchema, LIMITS } from '@kadro/contracts';
import { type User, users } from '@kadro/db';
import { eq, sql } from 'drizzle-orm';

import { recordAudit } from '../audit';
import { ApiError, findPgError, SQLSTATE } from '../errors';
import { type ProviderIdentity } from '../oauth/providers';
import { type ServerRuntime } from '../runtime';
import { mediaUrlBuilder } from '../uploads/urls';
import { admitSignIn } from './account-state';
import { toMeResponse } from './profile';
import { signedInResponse, startSession } from './sessions';

/**
 * Password and provider sign-in (matrix §3.1, footnote 3; ADR-0012, ADR-0014, ADR-0015).
 */

export interface SignInContext {
  readonly runtime: ServerRuntime;
  readonly client: AuthClient;
  readonly ip: string | null;
  readonly attempts: {
    recordFailure(): Promise<void>;
    recordSuccess(): Promise<void>;
  } | null;
}

/**
 * `POST auth/login`. The work is the same whether or not the account exists: one lookup and one
 * full Argon2id verification (against a dummy hash for unknown and social-only accounts), and
 * every failure is the same 401 `invalid_credentials`. Account state is evaluated only after the
 * password was verified. Login works before email verification (ADR-0015).
 */
export async function loginWithPassword(
  context: SignInContext,
  input: { email: string; password: string; deviceLabel?: string | undefined },
): Promise<Response> {
  const { runtime } = context;
  const [user] = await runtime.db
    .select()
    .from(users)
    .where(eq(sql`lower(${users.email})`, input.email))
    .limit(1);
  const valid = await verifyPassword(user?.passwordHash ?? null, input.password);
  if (!valid || user === undefined) {
    await context.attempts?.recordFailure();
    throw new ApiError('invalid_credentials');
  }

  const result = await runtime.db.transaction(async (tx) => {
    // The password was verified against a snapshot of the row. A reset or deactivation that
    // committed meanwhile must win: re-read the row under a lock (password reset locks the same
    // row) and refuse when the hash or the account state is no longer what was verified.
    const [current] = await tx
      .select({ passwordHash: users.passwordHash, deactivatedAt: users.deactivatedAt })
      .from(users)
      .where(eq(users.id, user.id))
      .for('update');
    if (
      current === undefined ||
      current.passwordHash !== user.passwordHash ||
      current.deactivatedAt?.getTime() !== user.deactivatedAt?.getTime()
    ) {
      throw new ApiError('invalid_credentials');
    }
    await admitSignIn(runtime, tx, user, context.ip);
    if (user.passwordHash !== null && passwordNeedsRehash(user.passwordHash)) {
      await tx
        .update(users)
        .set({ passwordHash: await hashPassword(input.password) })
        .where(eq(users.id, user.id));
    }
    const session = await startSession(runtime, tx, {
      userId: user.id,
      client: context.client,
      deviceLabel: input.deviceLabel,
    });
    const [fresh] = await tx.select().from(users).where(eq(users.id, user.id));
    return { session, user: fresh ?? user };
  });
  await context.attempts?.recordSuccess();
  return signedInResponse(result.session, toMeResponse(result.user, mediaUrlBuilder(runtime.env)));
}

const FALLBACK_DISPLAY_NAME = 'Kadro';

/** Display name for an account created by a provider sign-in. */
function initialDisplayName(identity: ProviderIdentity, requested: string | undefined): string {
  for (const candidate of [requested, identity.name, identity.email?.split('@')[0]]) {
    if (candidate === undefined || candidate === null) {
      continue;
    }
    const parsed = displayNameSchema.safeParse(candidate.slice(0, LIMITS.displayName.max));
    if (parsed.success) {
      return parsed.data;
    }
  }
  return FALLBACK_DISPLAY_NAME;
}

function subjectColumn(identity: ProviderIdentity) {
  return identity.provider === 'apple' ? users.appleSub : users.googleSub;
}

function linkedSubject(user: User, identity: ProviderIdentity): string | null {
  return identity.provider === 'apple' ? user.appleSub : user.googleSub;
}

/**
 * Resolves the account of a verified provider identity, in this order:
 * 1. an account already linked to the provider subject signs in;
 * 2. an account with the same email is linked only when the provider asserts the email as
 *    verified **and** the account's email is verified, and the account has no other subject of
 *    this provider; otherwise 409 `account_link_required` (pre-account takeover, T-AUTH-07);
 * 3. otherwise a new account is created; its email counts as verified only when the provider
 *    says so. A token without an email cannot create an account (401 `token_invalid`).
 */
export async function signInWithProvider(
  context: SignInContext,
  identity: ProviderIdentity,
  input: { displayName?: string | undefined; deviceLabel?: string | undefined },
): Promise<Response> {
  const { runtime } = context;
  const column = subjectColumn(identity);
  const resolve = () =>
    runtime.db.transaction(async (tx) => {
      const now = runtime.now();
      let [user] = await tx
        .select()
        .from(users)
        .where(eq(column, identity.subject))
        .limit(1)
        .for('update');

      if (user === undefined) {
        if (identity.email === null) {
          throw new ApiError('token_invalid');
        }
        const [byEmail] = await tx
          .select()
          .from(users)
          .where(eq(sql`lower(${users.email})`, identity.email))
          .limit(1)
          .for('update');
        if (byEmail !== undefined) {
          if (
            !identity.emailVerified ||
            byEmail.emailVerifiedAt === null ||
            linkedSubject(byEmail, identity) !== null
          ) {
            throw new ApiError('account_link_required');
          }
          const [linked] = await tx
            .update(users)
            .set(
              identity.provider === 'apple'
                ? { appleSub: identity.subject }
                : { googleSub: identity.subject },
            )
            .where(eq(users.id, byEmail.id))
            .returning();
          await recordAudit(tx, runtime.keyedHash, {
            actorId: byEmail.id,
            action: 'auth.providerLinked',
            targetType: 'user',
            targetId: byEmail.id,
            ip: context.ip,
            metadata: { provider: identity.provider },
          });
          user = linked ?? byEmail;
        } else {
          const [created] = await tx
            .insert(users)
            .values({
              email: identity.email,
              emailVerifiedAt: identity.emailVerified ? now : null,
              displayName: initialDisplayName(identity, input.displayName),
              ...(identity.provider === 'apple'
                ? { appleSub: identity.subject }
                : { googleSub: identity.subject }),
            })
            .returning();
          if (created === undefined) {
            throw new Error('user insert returned no row');
          }
          user = created;
        }
      }

      await admitSignIn(runtime, tx, user, context.ip);
      const session = await startSession(runtime, tx, {
        userId: user.id,
        client: context.client,
        deviceLabel: input.deviceLabel,
      });
      const [fresh] = await tx.select().from(users).where(eq(users.id, user.id));
      return { session, user: fresh ?? user };
    });
  let result: Awaited<ReturnType<typeof resolve>>;
  try {
    result = await resolve();
  } catch (error) {
    // Two first sign-ins of one identity race to create the account; the loser hits the unique
    // index on the subject (or email) and resolves again, now finding the winner's row.
    if (findPgError(error)?.code !== SQLSTATE.uniqueViolation) {
      throw error;
    }
    result = await resolve();
  }
  await context.attempts?.recordSuccess();
  return signedInResponse(result.session, toMeResponse(result.user, mediaUrlBuilder(runtime.env)));
}
