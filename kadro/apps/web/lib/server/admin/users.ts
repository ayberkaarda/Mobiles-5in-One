import { can, type ResourceContext } from '@kadro/auth';
import {
  type AdminUser,
  type ListAdminUsersQuery,
  maskEmail,
  type Paginated,
  type PlatformRole,
} from '@kadro/contracts';
import { deletionRequests, type Transaction, users } from '@kadro/db';
import { and, asc, eq, ilike, isNull, sql } from 'drizzle-orm';

import { recordAudit } from '../audit';
import { actorContext } from '../authorize';
import { revokeAllSessions } from '../auth/sessions';
import { defineKeyset, openPage } from '../domain/pagination';
import { type DbReader } from '../domain/relations';
import { ApiError } from '../errors';
import { actorIdOf } from '../teams/context';
import { escapeLike } from '../venues/venues';
import { type AdminRequest, type FreshTotpPurpose, verifyFreshStaffTotp } from './step-up';

/**
 * Accounts and platform roles (`GET admin/users`, `PATCH admin/users/:id/role`,
 * `PATCH admin/users/:id/deactivate`; authorization matrix §3.8 footnote 27, §6, ADR-0009,
 * ADR-0064, ADR-0067). Lists show a masked email only and never a tombstone. Role changes and
 * deactivation are admin-only, need the step-up window and a fresh TOTP code in the body, never
 * target the caller, and never leave the platform without an active admin.
 */

const ADMIN_USERS = defineKeyset('admin.users', [
  { column: users.createdAt, type: 'timestamp', direction: 'desc' },
  { column: users.id, type: 'uuid', direction: 'desc' },
]);

const USER_COLUMNS = {
  id: users.id,
  displayName: users.displayName,
  email: users.email,
  role: users.role,
  emailVerifiedAt: users.emailVerifiedAt,
  deactivatedAt: users.deactivatedAt,
  totpEnrolled: sql<boolean>`${users.totpSecretEnc} is not null`.mapWith(Boolean),
  createdAt: users.createdAt,
};

interface UserRow {
  readonly id: string;
  readonly displayName: string;
  readonly email: string;
  readonly role: PlatformRole;
  readonly emailVerifiedAt: Date | null;
  readonly deactivatedAt: Date | null;
  readonly totpEnrolled: boolean;
  readonly createdAt: Date;
}

function toAdminUser(row: UserRow): AdminUser {
  return {
    id: row.id,
    displayName: row.displayName,
    maskedEmail: maskEmail(row.email),
    role: row.role,
    emailVerified: row.emailVerifiedAt !== null,
    deactivatedAt: row.deactivatedAt === null ? null : row.deactivatedAt.toISOString(),
    totpEnrolled: row.totpEnrolled,
    createdAt: row.createdAt.toISOString(),
  };
}

async function loadAdminUser(db: DbReader, userId: string): Promise<AdminUser> {
  const [row] = await db
    .select(USER_COLUMNS)
    .from(users)
    .where(and(eq(users.id, userId), eq(users.isTombstone, false)))
    .limit(1);
  if (row === undefined) {
    throw new ApiError('not_found');
  }
  return toAdminUser(row);
}

/** `GET admin/users` (`admin.read`): newest first; `role` filter, `q` over display names. */
export async function listAdminUsers(
  { ctx, runtime }: AdminRequest,
  query: ListAdminUsersQuery,
): Promise<Paginated<AdminUser>> {
  await ctx.authorize('admin.read');
  const page = openPage(
    ADMIN_USERS,
    { cursor: query.cursor, limit: query.limit, filters: { role: query.role, q: query.q } },
    runtime.keyedHash,
  );
  const rows = await runtime.db
    .select({ ...USER_COLUMNS, pageKey: page.key })
    .from(users)
    .where(
      and(
        eq(users.isTombstone, false),
        query.role === undefined ? undefined : eq(users.role, query.role),
        query.q === undefined ? undefined : ilike(users.displayName, `%${escapeLike(query.q)}%`),
        page.where,
      ),
    )
    .orderBy(...page.orderBy)
    .limit(page.fetchSize);
  return page.finish(rows, toAdminUser);
}

type AccountAction = 'admin.role.manage' | 'admin.user.deactivate';

/**
 * Policy order of footnote 27 without spending the code: staff role (403), step-up (401
 * `step_up_required`), admin tier (403) and own account (403) are decided as if the code were
 * valid, so a request that fails any of them never consumes a TOTP step. A denial is thrown
 * through the request's gate, which records the consultation.
 */
async function precheck(
  { ctx, runtime }: AdminRequest,
  action: AccountAction,
  facts: ResourceContext,
): Promise<void> {
  const hypothetical = { ...facts, freshTotp: true };
  const decision = can(
    actorContext(ctx.principal, ctx.principal?.stepUpUntil ?? null),
    action,
    hypothetical,
    {
      now: runtime.now(),
    },
  );
  if (!decision.allow) {
    // Throws the same denial; `freshTotp: true` here cannot turn it into an allow.
    await ctx.authorize(action, hypothetical);
    throw new ApiError('forbidden');
  }
}

/** 404 for an unknown id or a tombstone (ADR-0033), before the code is checked. */
async function assertTargetExists(db: DbReader, userId: string): Promise<void> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.isTombstone, false)))
    .limit(1);
  if (row === undefined) {
    throw new ApiError('not_found');
  }
}

/** Per-action code (footnote 27): a wrong, reused or missing code answers 401 `totp_invalid`. */
async function requireFreshCode(
  request: AdminRequest,
  actorId: string,
  code: string,
  purpose: FreshTotpPurpose,
): Promise<void> {
  if (!(await verifyFreshStaffTotp(request, actorId, code, purpose))) {
    throw new ApiError('totp_invalid');
  }
}

interface LockedAccounts {
  readonly target: {
    readonly role: PlatformRole;
    readonly deactivatedAt: Date | null;
  };
  /** Active admins other than the target, counted under the locks. */
  readonly otherActiveAdmins: number;
}

/**
 * Locks every active admin row in id order (the same order as `DELETE me`), then the target row,
 * and re-checks under the locks that the actor is still an active admin: two admins demoting or
 * deactivating each other concurrently serialize here, and the second one is refused.
 */
async function lockAccounts(
  tx: Transaction,
  actorId: string,
  targetId: string,
): Promise<LockedAccounts> {
  const admins = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, 'admin'), isNull(users.deactivatedAt), eq(users.isTombstone, false)))
    .orderBy(asc(users.id))
    .for('update');
  if (!admins.some((admin) => admin.id === actorId)) {
    throw new ApiError('forbidden');
  }
  const [target] = await tx
    .select({ role: users.role, deactivatedAt: users.deactivatedAt })
    .from(users)
    .where(and(eq(users.id, targetId), eq(users.isTombstone, false)))
    .for('update');
  if (target === undefined) {
    throw new ApiError('not_found');
  }
  return {
    target,
    otherActiveAdmins: admins.filter((admin) => admin.id !== targetId).length,
  };
}

/** True when the change would leave no active admin (409 `last_admin`). */
function removesLastAdmin(locked: LockedAccounts): boolean {
  const targetIsActiveAdmin =
    locked.target.role === 'admin' && locked.target.deactivatedAt === null;
  return targetIsActiveAdmin && locked.otherActiveAdmins === 0;
}

/**
 * `PATCH admin/users/:id/role` (`admin.role.manage`, admin + step-up + fresh TOTP). Own account →
 * 403; unknown id → 404; wrong code → 401 `totp_invalid`; demoting the last active admin → 409
 * `last_admin`. One `user.roleChanged` audit row with the old and new role (also when unchanged).
 */
export async function setUserRole(
  request: AdminRequest,
  targetId: string,
  body: { readonly role: PlatformRole; readonly totpCode: string },
): Promise<AdminUser> {
  const { ctx, runtime } = request;
  const actorId = actorIdOf(ctx);
  const facts = { isSelf: targetId === actorId };
  await precheck(request, 'admin.role.manage', facts);
  await assertTargetExists(runtime.db, targetId);
  await requireFreshCode(request, actorId, body.totpCode, 'roleChange');
  await ctx.authorize('admin.role.manage', { ...facts, freshTotp: true });

  return runtime.db.transaction(async (tx) => {
    const locked = await lockAccounts(tx, actorId, targetId);
    const previous = locked.target.role;
    if (body.role !== 'admin' && removesLastAdmin(locked)) {
      throw new ApiError('last_admin');
    }
    const now = runtime.now();
    if (previous !== body.role) {
      await tx.update(users).set({ role: body.role, updatedAt: now }).where(eq(users.id, targetId));
    }
    await recordAudit(tx, runtime.keyedHash, {
      actorId,
      action: 'user.roleChanged',
      targetType: 'user',
      targetId,
      ip: ctx.ip,
      metadata: { from: previous, to: body.role, changed: previous !== body.role },
    });
    return loadAdminUser(tx, targetId);
  });
}

/**
 * `PATCH admin/users/:id/deactivate` (`admin.user.deactivate`, admin + step-up + fresh TOTP).
 * `deactivated: true` sets `deactivated_at` (kept when already set) and revokes every refresh
 * family and web session, so the account answers 401 `account_deactivated` on its next request;
 * deactivating the last active admin → 409 `last_admin`. `false` lifts the deactivation unless a
 * self-initiated deletion is pending (409 `deletion_pending`; only signing in cancels it). One
 * `user.deactivated` or `user.reactivated` audit row (also when the state was already set).
 */
export async function setUserDeactivated(
  request: AdminRequest,
  targetId: string,
  body: { readonly deactivated: boolean; readonly totpCode: string },
): Promise<AdminUser> {
  const { ctx, runtime } = request;
  const actorId = actorIdOf(ctx);
  const facts = { isSelf: targetId === actorId };
  await precheck(request, 'admin.user.deactivate', facts);
  await assertTargetExists(runtime.db, targetId);
  await requireFreshCode(request, actorId, body.totpCode, 'deactivation');
  await ctx.authorize('admin.user.deactivate', { ...facts, freshTotp: true });

  return runtime.db.transaction(async (tx) => {
    const locked = await lockAccounts(tx, actorId, targetId);
    const now = runtime.now();
    const wasDeactivated = locked.target.deactivatedAt !== null;
    if (body.deactivated) {
      if (removesLastAdmin(locked)) {
        throw new ApiError('last_admin');
      }
      if (!wasDeactivated) {
        await tx
          .update(users)
          .set({ deactivatedAt: now, updatedAt: now })
          .where(eq(users.id, targetId));
      }
      // Revoked even when already deactivated: no session of a deactivated account stays live.
      await revokeAllSessions(tx, targetId, now);
    } else {
      const [pending] = await tx
        .select({ id: deletionRequests.id })
        .from(deletionRequests)
        .where(and(eq(deletionRequests.userId, targetId), isNull(deletionRequests.completedAt)))
        .limit(1);
      if (pending !== undefined) {
        throw new ApiError('deletion_pending');
      }
      if (wasDeactivated) {
        await tx
          .update(users)
          .set({ deactivatedAt: null, updatedAt: now })
          .where(eq(users.id, targetId));
      }
    }
    await recordAudit(tx, runtime.keyedHash, {
      actorId,
      action: body.deactivated ? 'user.deactivated' : 'user.reactivated',
      targetType: 'user',
      targetId,
      ip: ctx.ip,
      metadata: { changed: wasDeactivated !== body.deactivated },
    });
    return loadAdminUser(tx, targetId);
  });
}
