import {
  auditActionSchema,
  type AuditLogEntry,
  auditMetadataSchema,
  auditTargetTypeSchema,
  type ListAuditLogsQuery,
  type Paginated,
} from '@kadro/contracts';
import { auditLogs, users } from '@kadro/db';
import { and, eq } from 'drizzle-orm';

import { defineKeyset, openPage } from '../domain/pagination';
import { type AdminRequest } from './step-up';

/**
 * `GET admin/audit-logs` (`admin.audit.read`, admin + step-up; authorization matrix §3.8, §9.3,
 * ADR-0064 §5). Newest first with optional filters. `ip_hash` is never selected; the actor is shown
 * by id and display name, and as `null` for system actions and deleted accounts (tombstones).
 */

const AUDIT_LOGS = defineKeyset('admin.audit-logs', [
  { column: auditLogs.createdAt, type: 'timestamp', direction: 'desc' },
  { column: auditLogs.id, type: 'uuid', direction: 'desc' },
]);

interface AuditRow {
  readonly id: string;
  readonly actorId: string | null;
  readonly actorDisplayName: string | null;
  readonly actorIsTombstone: boolean | null;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdAt: Date;
}

/**
 * Only short scalar metadata leaves the server (`auditMetadataSchema`): entries with another key
 * shape or value type are dropped rather than echoed.
 */
function safeMetadata(stored: Readonly<Record<string, unknown>>): AuditLogEntry['metadata'] {
  const metadata: AuditLogEntry['metadata'] = {};
  for (const [key, value] of Object.entries(stored)) {
    const single = auditMetadataSchema.safeParse({ [key]: value });
    if (single.success) {
      Object.assign(metadata, single.data);
    }
  }
  return metadata;
}

function toAuditLogEntry(row: AuditRow): AuditLogEntry {
  const actor =
    row.actorId !== null && row.actorDisplayName !== null && row.actorIsTombstone === false
      ? { id: row.actorId, displayName: row.actorDisplayName }
      : null;
  return {
    id: row.id,
    actor,
    // Stored rows are written by the server with valid names; a legacy value is shown as-is only
    // when it still fits the response schema.
    action: auditActionSchema.safeParse(row.action).success ? row.action : 'unknown.action',
    targetType: auditTargetTypeSchema.safeParse(row.targetType).success
      ? row.targetType
      : 'unknown',
    targetId: row.targetId,
    metadata: safeMetadata(row.metadata),
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listAuditLogs(
  { ctx, runtime }: AdminRequest,
  query: ListAuditLogsQuery,
): Promise<Paginated<AuditLogEntry>> {
  await ctx.authorize('admin.audit.read');
  const page = openPage(
    AUDIT_LOGS,
    {
      cursor: query.cursor,
      limit: query.limit,
      filters: {
        action: query.action,
        actor: query.actor,
        targetType: query.targetType,
        target: query.target,
      },
    },
    runtime.keyedHash,
  );
  const rows = await runtime.db
    .select({
      id: auditLogs.id,
      actorId: auditLogs.actorId,
      actorDisplayName: users.displayName,
      actorIsTombstone: users.isTombstone,
      action: auditLogs.action,
      targetType: auditLogs.targetType,
      targetId: auditLogs.targetId,
      metadata: auditLogs.metadata,
      createdAt: auditLogs.createdAt,
      pageKey: page.key,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorId))
    .where(
      and(
        query.action === undefined ? undefined : eq(auditLogs.action, query.action),
        query.actor === undefined ? undefined : eq(auditLogs.actorId, query.actor),
        query.targetType === undefined ? undefined : eq(auditLogs.targetType, query.targetType),
        query.target === undefined ? undefined : eq(auditLogs.targetId, query.target),
        page.where,
      ),
    )
    .orderBy(...page.orderBy)
    .limit(page.fetchSize);
  return page.finish(rows, toAuditLogEntry);
}
