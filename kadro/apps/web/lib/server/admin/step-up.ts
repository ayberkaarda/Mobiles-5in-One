import {
  type AdminStepUpResponse,
  type AdminTotpEnrollResponse,
  LIMITS,
  type PlatformRole,
  RATE_LIMIT_GROUPS,
  type ReauthProofFields,
} from '@kadro/contracts';
import {
  confirmPendingTotpSecret,
  type Database,
  getTotpEnrollment,
  refreshTokens,
  setPendingTotpSecret,
  type Transaction,
  users,
} from '@kadro/db';
import { and, eq, gt, isNull, lt, or } from 'drizzle-orm';

import { verifyReauthProof } from '../account/reauth';
import { recordAudit } from '../audit';
import { ApiError } from '../errors';
import { type RequestContext } from '../http';
import { type ServerRuntime } from '../runtime';
import {
  base32Encode,
  decryptTotpSecret,
  encryptTotpSecret,
  generateTotpSecret,
  matchTotpStep,
  otpauthUri,
  TOTP_DIGITS,
  TOTP_PERIOD_SECONDS,
  totpKey,
} from './totp';

/**
 * Staff TOTP flows (security checklist item 18, authorization matrix §3.8 footnotes 26 and 27,
 * ADR-0064, ADR-0066):
 *
 * - `POST admin/totp/enroll`: re-authentication proof, then a new pending secret (shown once);
 * - `POST admin/totp/confirm`: a code from the pending secret activates it;
 * - `POST admin/step-up`: a code from the active secret opens the 15-minute step-up window on the
 *   current web session row or mobile refresh-token family;
 * - {@link verifyFreshStaffTotp}: the per-action code of staff account deletion, role changes and
 *   deactivation.
 *
 * Every code check is throttled per user (5 attempts per 15 minutes, shared by all TOTP checks of
 * the account and cleared by a correct code) and consumes its time step in one conditional update,
 * so the same code is accepted once even under concurrent requests. Successes and failures are
 * audited; codes, secrets and proofs are never logged or stored in clear.
 */

export interface AdminRequest {
  readonly ctx: RequestContext;
  readonly runtime: ServerRuntime;
}

const ATTEMPT_RULE = {
  max: RATE_LIMIT_GROUPS.T.max,
  windowSeconds: RATE_LIMIT_GROUPS.T.windowSeconds,
} as const;

function isStaff(role: PlatformRole): boolean {
  return role === 'moderator' || role === 'admin';
}

function principalOf(ctx: RequestContext): NonNullable<RequestContext['principal']> {
  if (ctx.principal === null) {
    throw new ApiError('unauthenticated');
  }
  return ctx.principal;
}

/** The encryption key, or 503 when TOTP is not configured (local without a key: fail closed). */
function requireKey(runtime: ServerRuntime): Buffer {
  const key = totpKey(runtime.env.TOTP_ENCRYPTION_KEY);
  if (key === null) {
    throw new ApiError('service_unavailable');
  }
  return key;
}

function attemptKey(runtime: ServerRuntime, userId: string): string {
  return `totp:user:${runtime.keyedHash('rate-limit', `totp-attempt:${userId}`)}`;
}

/** Counts one code attempt; 429 `rate_limited` with `Retry-After` once the budget is spent. */
async function chargeAttempt(runtime: ServerRuntime, userId: string): Promise<void> {
  const result = await runtime.limiter.hit(attemptKey(runtime, userId), ATTEMPT_RULE);
  if (!result.allowed) {
    throw new ApiError('rate_limited', {
      headers: { 'Retry-After': String(result.retryAfterSeconds) },
    });
  }
}

async function clearAttempts(runtime: ServerRuntime, userId: string): Promise<void> {
  await runtime.limiter.reset(attemptKey(runtime, userId));
}

/**
 * Stores `step` as the last accepted step if it is newer than the stored one and the active
 * secret is still `ciphertext`; `false` when a concurrent request already used it.
 */
async function consumeStep(
  db: Database | Transaction,
  userId: string,
  ciphertext: string,
  step: number,
  now: Date,
): Promise<boolean> {
  const rows = await db
    .update(users)
    .set({ totpLastUsedStep: step, updatedAt: now })
    .where(
      and(
        eq(users.id, userId),
        eq(users.totpSecretEnc, ciphertext),
        or(isNull(users.totpLastUsedStep), lt(users.totpLastUsedStep, step)),
      ),
    )
    .returning({ id: users.id });
  return rows.length > 0;
}

interface ActiveSecret {
  readonly ciphertext: string;
  readonly lastUsedStep: number | null;
}

async function loadActiveSecret(
  runtime: ServerRuntime,
  userId: string,
): Promise<ActiveSecret | null> {
  const [row] = await runtime.db
    .select({ ciphertext: users.totpSecretEnc, lastUsedStep: users.totpLastUsedStep })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (row?.ciphertext === undefined || row.ciphertext === null) {
    return null;
  }
  return { ciphertext: row.ciphertext, lastUsedStep: row.lastUsedStep };
}

type CodeCheck =
  | { readonly ok: true; readonly step: number; readonly ciphertext: string }
  | { readonly ok: false };

/** Throttled check of `code` against the active secret; the step is not consumed yet. */
async function checkActiveCode(
  runtime: ServerRuntime,
  key: Buffer,
  userId: string,
  secret: ActiveSecret,
  code: string,
): Promise<CodeCheck> {
  await chargeAttempt(runtime, userId);
  const plain = decryptTotpSecret(key, userId, secret.ciphertext);
  const step = matchTotpStep(plain, code, runtime.now(), secret.lastUsedStep);
  plain.fill(0);
  return step === null ? { ok: false } : { ok: true, step, ciphertext: secret.ciphertext };
}

async function auditFailure(
  { ctx, runtime }: AdminRequest,
  userId: string,
  action: string,
  reason: string,
): Promise<void> {
  await recordAudit(runtime.db, runtime.keyedHash, {
    actorId: userId,
    action,
    targetType: 'user',
    targetId: userId,
    ip: ctx.ip,
    metadata: { reason, client: ctx.client },
  });
}

// ---------------------------------------------------------------------------
// Step-up
// ---------------------------------------------------------------------------

/**
 * `POST admin/step-up`: 409 `totp_not_enrolled` without an active secret, 401 `totp_invalid` for
 * a wrong, reused or out-of-window code. On success the window ends 15 minutes from now on the
 * session row (web) or every live row of the refresh-token family (mobile; rotation carries it to
 * the next row).
 */
export async function establishStepUp(
  request: AdminRequest,
  code: string,
): Promise<AdminStepUpResponse> {
  const { ctx, runtime } = request;
  await ctx.authorize('admin.stepUp');
  const principal = principalOf(ctx);
  const userId = principal.userId;
  const sessionRowId = principal.client === 'web' ? principal.sessionRowId : null;
  if (principal.client === 'web' && sessionRowId === null) {
    throw new ApiError('unauthenticated');
  }
  const key = requireKey(runtime);

  const active = await loadActiveSecret(runtime, userId);
  if (active === null) {
    await auditFailure(request, userId, 'admin.stepUpFailed', 'not_enrolled');
    throw new ApiError('totp_not_enrolled');
  }
  const check = await checkActiveCode(runtime, key, userId, active, code);
  if (!check.ok) {
    await auditFailure(request, userId, 'admin.stepUpFailed', 'invalid');
    throw new ApiError('totp_invalid');
  }

  const result = await runtime.db.transaction(async (tx) => {
    const now = runtime.now();
    if (!(await consumeStep(tx, userId, check.ciphertext, check.step, now))) {
      return null;
    }
    const stepUpUntil = new Date(now.getTime() + LIMITS.stepUpWindowSeconds * 1_000);
    const bound =
      sessionRowId !== null
        ? and(eq(refreshTokens.id, sessionRowId), eq(refreshTokens.client, 'web'))
        : and(eq(refreshTokens.familyId, principal.sessionId), eq(refreshTokens.client, 'mobile'));
    const updated = await tx
      .update(refreshTokens)
      .set({ stepUpUntil })
      .where(
        and(
          bound,
          eq(refreshTokens.userId, userId),
          isNull(refreshTokens.revokedAt),
          gt(refreshTokens.expiresAt, now),
        ),
      )
      .returning({ id: refreshTokens.id });
    if (updated.length === 0) {
      // The session was revoked between authentication and this statement.
      throw new ApiError('unauthenticated');
    }
    await recordAudit(tx, runtime.keyedHash, {
      actorId: userId,
      action: 'admin.stepUp',
      targetType: 'user',
      targetId: userId,
      ip: ctx.ip,
      metadata: { client: principal.client },
    });
    return stepUpUntil;
  });
  if (result === null) {
    await auditFailure(request, userId, 'admin.stepUpFailed', 'reused');
    throw new ApiError('totp_invalid');
  }
  await clearAttempts(runtime, userId);
  return { stepUpUntil: result.toISOString() };
}

// ---------------------------------------------------------------------------
// Fresh code per action
// ---------------------------------------------------------------------------

export type FreshTotpPurpose = 'accountDeletion' | 'roleChange' | 'deactivation';

/**
 * Fresh TOTP code of a staff action (matrix footnotes 5 and 27): `true` only when `code` is valid
 * for the active secret and its step was not used before; the step is consumed. Without a code,
 * a secret or a configured key the answer is `false` (the policy then denies), never a pass.
 */
export async function verifyFreshStaffTotp(
  request: AdminRequest,
  userId: string,
  code: string | undefined,
  purpose: FreshTotpPurpose,
): Promise<boolean> {
  const { runtime } = request;
  const key = totpKey(runtime.env.TOTP_ENCRYPTION_KEY);
  if (code === undefined || key === null) {
    return false;
  }
  const active = await loadActiveSecret(runtime, userId);
  if (active === null) {
    return false;
  }
  const check = await checkActiveCode(runtime, key, userId, active, code);
  const consumed =
    check.ok &&
    (await consumeStep(runtime.db, userId, check.ciphertext, check.step, runtime.now()));
  if (!consumed) {
    await auditFailure(request, userId, 'admin.freshTotpFailed', purpose);
    return false;
  }
  await clearAttempts(runtime, userId);
  return true;
}

// ---------------------------------------------------------------------------
// Enrollment
// ---------------------------------------------------------------------------

/** 403 for a non-staff caller before any account data is read. */
async function assertStaff(ctx: RequestContext): Promise<NonNullable<RequestContext['principal']>> {
  const principal = principalOf(ctx);
  if (!isStaff(principal.platformRole)) {
    // The policy answers 403 `forbidden` for every non-staff actor of `admin.totpEnroll`.
    await ctx.authorize('admin.totpEnroll', { reauthenticated: false });
    throw new ApiError('forbidden');
  }
  return principal;
}

/**
 * `POST admin/totp/enroll`: 409 `totp_already_enrolled` with an active secret, 401
 * `reauth_required` without a valid proof. Stores a new pending secret (replacing an earlier
 * pending one) and returns it once.
 */
export async function startTotpEnrollment(
  request: AdminRequest,
  proof: ReauthProofFields,
): Promise<AdminTotpEnrollResponse> {
  const { ctx, runtime } = request;
  const principal = await assertStaff(ctx);
  const userId = principal.userId;
  const key = requireKey(runtime);

  const [account] = await runtime.db
    .select({
      id: users.id,
      email: users.email,
      passwordHash: users.passwordHash,
      appleSub: users.appleSub,
      googleSub: users.googleSub,
      active: users.totpSecretEnc,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (account === undefined) {
    throw new ApiError('unauthenticated');
  }
  if (account.active !== null) {
    throw new ApiError('totp_already_enrolled');
  }
  const reauthenticated = await verifyReauthProof(runtime, account, proof);
  if (!reauthenticated) {
    await auditFailure(request, userId, 'admin.totpEnrollFailed', 'reauth');
  }
  await ctx.authorize('admin.totpEnroll', { reauthenticated });

  const secret = generateTotpSecret();
  const base32 = base32Encode(secret);
  const ciphertext = encryptTotpSecret(key, userId, secret);
  secret.fill(0);
  const now = runtime.now();
  const stored = await runtime.db.transaction(async (tx) => {
    const outcome = await setPendingTotpSecret(tx, userId, ciphertext, now);
    if (outcome === 'stored') {
      await recordAudit(tx, runtime.keyedHash, {
        actorId: userId,
        action: 'admin.totpEnrollStarted',
        targetType: 'user',
        targetId: userId,
        ip: ctx.ip,
        metadata: { client: principal.client },
      });
    }
    return outcome;
  });
  if (stored === 'already_enrolled') {
    throw new ApiError('totp_already_enrolled');
  }
  if (stored === 'user_not_found') {
    throw new ApiError('unauthenticated');
  }
  return {
    secret: base32,
    otpauthUri: otpauthUri(base32, account.email),
    algorithm: 'SHA1',
    digits: TOTP_DIGITS,
    periodSeconds: TOTP_PERIOD_SECONDS,
    confirmBy: new Date(now.getTime() + LIMITS.totpEnrollmentWindowSeconds * 1_000).toISOString(),
  };
}

/**
 * `POST admin/totp/confirm`: activates the pending secret with a code from it. 409
 * `totp_already_enrolled` with an active secret, 409 `totp_not_enrolled` without a pending secret
 * or after its 10-minute window, 401 `totp_invalid` for a wrong code (or one from a pending secret
 * that a newer enrollment replaced). The proof of this step is the pending secret itself, which
 * only a re-authenticated enrollment of the last 10 minutes can create (ADR-0066).
 */
export async function confirmTotpEnrollment(request: AdminRequest, code: string): Promise<void> {
  const { ctx, runtime } = request;
  const principal = await assertStaff(ctx);
  await ctx.authorize('admin.totpEnroll', { reauthenticated: true });
  const userId = principal.userId;
  const key = requireKey(runtime);

  const state = await getTotpEnrollment(runtime.db, userId);
  if (state === undefined) {
    throw new ApiError('unauthenticated');
  }
  if (state.active) {
    throw new ApiError('totp_already_enrolled');
  }
  const now = runtime.now();
  const windowMs = LIMITS.totpEnrollmentWindowSeconds * 1_000;
  if (state.pending === null || state.pending.createdAt.getTime() + windowMs < now.getTime()) {
    await auditFailure(request, userId, 'admin.totpConfirmFailed', 'not_enrolled');
    throw new ApiError('totp_not_enrolled');
  }
  await chargeAttempt(runtime, userId);
  const plain = decryptTotpSecret(key, userId, state.pending.ciphertext);
  const step = matchTotpStep(plain, code, now, null);
  plain.fill(0);
  if (step === null) {
    await auditFailure(request, userId, 'admin.totpConfirmFailed', 'invalid');
    throw new ApiError('totp_invalid');
  }
  const pendingCiphertext = state.pending.ciphertext;
  const outcome = await runtime.db.transaction(async (tx) => {
    const result = await confirmPendingTotpSecret(
      tx,
      {
        userId,
        expectedCiphertext: pendingCiphertext,
        step,
        windowSeconds: LIMITS.totpEnrollmentWindowSeconds,
      },
      runtime.now(),
    );
    if (result === 'confirmed') {
      await recordAudit(tx, runtime.keyedHash, {
        actorId: userId,
        action: 'admin.totpEnrolled',
        targetType: 'user',
        targetId: userId,
        ip: ctx.ip,
        metadata: { client: principal.client },
      });
    }
    return result;
  });
  switch (outcome) {
    case 'confirmed':
      await clearAttempts(runtime, userId);
      return;
    case 'already_enrolled':
      throw new ApiError('totp_already_enrolled');
    case 'replaced':
      await auditFailure(request, userId, 'admin.totpConfirmFailed', 'replaced');
      throw new ApiError('totp_invalid');
    case 'no_pending':
    case 'expired':
      await auditFailure(request, userId, 'admin.totpConfirmFailed', 'not_enrolled');
      throw new ApiError('totp_not_enrolled');
  }
}
