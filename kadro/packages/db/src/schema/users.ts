import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  index,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import {
  lowerExpr,
  primaryId,
  sha256Hex,
  sha256HexCheck,
  timestamps,
  timestamptz,
} from './columns.js';
import { districts } from './districts.js';
import {
  type ExternalCleanupTarget,
  emailTokenPurposeEnum,
  playerLevelEnum,
  playerPositionEnum,
  sessionClientEnum,
  userRoleEnum,
} from './enums.js';

export const users = pgTable(
  'users',
  {
    id: primaryId(),
    email: text('email').notNull(),
    emailVerifiedAt: timestamptz('email_verified_at'),
    /** Argon2id PHC string (`$argon2id$...`); null for social-only accounts. */
    passwordHash: text('password_hash'),
    appleSub: text('apple_sub'),
    googleSub: text('google_sub'),
    displayName: text('display_name').notNull(),
    avatarKey: text('avatar_key'),
    position: playerPositionEnum('position'),
    level: playerLevelEnum('level'),
    districtId: uuid('district_id').references(() => districts.id, { onDelete: 'set null' }),
    role: userRoleEnum('role').notNull().default('user'),
    /** AES-256-GCM ciphertext of the TOTP secret (staff only). */
    totpSecretEnc: text('totp_secret_enc'),
    /** Last accepted TOTP time step, so a code cannot be replayed inside its window. */
    totpLastUsedStep: bigint('totp_last_used_step', { mode: 'number' }),
    deactivatedAt: timestamptz('deactivated_at'),
    /**
     * Per-account tombstone created by the hard delete (ADR-0033). It holds the deleted user's
     * match history, carries no credentials or personal data and can never authenticate.
     */
    isTombstone: boolean('is_tombstone').notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('users_email_lower_key').on(lowerExpr(t.email)),
    uniqueIndex('users_apple_sub_key').on(t.appleSub),
    uniqueIndex('users_google_sub_key').on(t.googleSub),
    index('users_district_id_idx').on(t.districtId),
    check('users_email_length', sql`char_length(${t.email}) between 3 and 254`),
    check('users_display_name_length', sql`char_length(${t.displayName}) between 2 and 40`),
    check(
      'users_password_hash_argon2id',
      sql`${t.passwordHash} is null or ${t.passwordHash} like '$argon2id$%'`,
    ),
    check(
      'users_tombstone_has_no_personal_data',
      sql`not ${t.isTombstone} or (${t.passwordHash} is null and ${t.appleSub} is null and ${t.googleSub} is null and ${t.avatarKey} is null and ${t.position} is null and ${t.level} is null and ${t.districtId} is null and ${t.totpSecretEnc} is null and ${t.deactivatedAt} is not null)`,
    ),
  ],
);

/**
 * Opaque refresh tokens of mobile clients and web session cookies (`client`), stored only as
 * SHA-256 hashes. Both kinds share the same rotation and family logic. Every rotation inserts a new row
 * pointing at its predecessor through `rotated_from`; all rows of one login share `family_id`
 * so reuse of a rotated token can revoke the whole family in one statement.
 */
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: primaryId(),
    tokenHash: sha256Hex('token_hash').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    client: sessionClientEnum('client').notNull(),
    familyId: uuid('family_id').notNull(),
    deviceLabel: text('device_label'),
    expiresAt: timestamptz('expires_at').notNull(),
    rotatedFrom: uuid('rotated_from').references((): AnyPgColumn => refreshTokens.id, {
      onDelete: 'set null',
    }),
    revokedAt: timestamptz('revoked_at'),
    /** Admin TOTP step-up bound to this token family; null when no step-up is active. */
    stepUpUntil: timestamptz('step_up_until'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('refresh_tokens_token_hash_key').on(t.tokenHash),
    index('refresh_tokens_user_id_client_idx').on(t.userId, t.client),
    index('refresh_tokens_family_id_idx').on(t.familyId),
    index('refresh_tokens_rotated_from_idx').on(t.rotatedFrom),
    sha256HexCheck('refresh_tokens_token_hash_format', t.tokenHash),
    check('refresh_tokens_device_label_length', sql`char_length(${t.deviceLabel}) <= 64`),
  ],
);

/** Single-use email verification and password reset tokens, stored only as SHA-256 hashes. */
export const emailTokens = pgTable(
  'email_tokens',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: emailTokenPurposeEnum('purpose').notNull(),
    tokenHash: sha256Hex('token_hash').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    usedAt: timestamptz('used_at'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('email_tokens_token_hash_key').on(t.tokenHash),
    index('email_tokens_user_id_purpose_idx').on(t.userId, t.purpose),
    sha256HexCheck('email_tokens_token_hash_format', t.tokenHash),
  ],
);

/**
 * Account deletion requests (security checklist item 21). `user_id` is cleared when the user row
 * is hard-deleted so the completion record survives without personal data.
 */
export const deletionRequests = pgTable(
  'deletion_requests',
  {
    id: primaryId(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    requestedAt: timestamptz('requested_at').notNull().defaultNow(),
    graceUntil: timestamptz('grace_until').notNull(),
    completedAt: timestamptz('completed_at'),
    /**
     * External cleanups still owed after the hard delete (ADR-0032), from the closed set
     * `EXTERNAL_CLEANUP_TARGETS`; processed later by the reconciliation job.
     */
    externalPending: text('external_pending')
      .array()
      .$type<ExternalCleanupTarget[]>()
      .notNull()
      .default(sql`'{}'::text[]`),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('deletion_requests_pending_user_key')
      .on(t.userId)
      .where(sql`${t.completedAt} is null`),
    index('deletion_requests_grace_until_idx')
      .on(t.graceUntil)
      .where(sql`${t.completedAt} is null`),
    check('deletion_requests_grace_after_request', sql`${t.graceUntil} > ${t.requestedAt}`),
    check(
      'deletion_requests_external_pending_values',
      sql`${t.externalPending} <@ array['revenuecat']::text[]`,
    ),
    index('deletion_requests_external_pending_idx')
      .on(t.id)
      .where(sql`cardinality(${t.externalPending}) > 0`),
  ],
);
