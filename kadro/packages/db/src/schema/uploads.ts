import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { primaryId, timestamps } from './columns.js';
import {
  uploadContentTypeEnum,
  uploadKindEnum,
  uploadRejectReasonEnum,
  uploadStatusEnum,
} from './enums.js';
import { teams } from './teams.js';
import { users } from './users.js';

/**
 * Image uploads (ADR-0030). `id` is the `uploadId` inside the object key: avatars live under
 * `avatars/{user_id}/{id}`, team badges under `badges/{team_id}/{id}`; the server derives the key,
 * the client never chooses it. `ready` means the re-encoded WebP is published under the key.
 */
export const uploads = pgTable(
  'uploads',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: uploadKindEnum('kind').notNull(),
    teamId: uuid('team_id').references(() => teams.id, { onDelete: 'cascade' }),
    contentType: uploadContentTypeEnum('content_type').notNull(),
    contentLength: integer('content_length').notNull(),
    status: uploadStatusEnum('status').notNull().default('pending'),
    rejectReason: uploadRejectReasonEnum('reject_reason'),
    key: text('key').notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('uploads_key_key').on(t.key),
    index('uploads_user_id_created_at_idx').on(t.userId, t.createdAt),
    index('uploads_status_created_at_idx').on(t.status, t.createdAt),
    index('uploads_team_id_idx').on(t.teamId),
    // 1..2 MiB, `LIMITS.uploadBytes` in packages/contracts.
    check('uploads_content_length_range', sql`${t.contentLength} between 1 and 2097152`),
    check('uploads_badge_has_team', sql`(${t.kind} = 'badge') = (${t.teamId} is not null)`),
    check(
      'uploads_rejected_has_reason',
      sql`(${t.status} = 'rejected') = (${t.rejectReason} is not null)`,
    ),
    check(
      'uploads_key_matches_owner',
      sql`${t.key} = case ${t.kind} when 'avatar' then 'avatars/' || ${t.userId}::text || '/' || ${t.id}::text else 'badges/' || ${t.teamId}::text || '/' || ${t.id}::text end`,
    ),
  ],
);
