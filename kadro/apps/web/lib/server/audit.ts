import { auditLogs, type Database, type Transaction } from '@kadro/db';

import { type KeyedHasher } from './keyed-hash';

/**
 * Append-only audit trail (`audit_logs`; security checklist items 18 and 21, matrix §9.3). The
 * client address is stored only as a keyed hash and `metadata` must not carry personal data:
 * keys that usually hold it are rejected so a careless caller fails in tests, not in production
 * data.
 */

export interface AuditEntry {
  readonly actorId: string | null;
  /** Dotted action name, e.g. `payment.mark` or `admin.role.manage`. */
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string | null;
  /** Normalized client address from the trusted proxy header, if known. */
  readonly ip: string | null;
  readonly metadata?: Readonly<Record<string, string | number | boolean | null>>;
}

const PERSONAL_DATA_KEYS = new Set([
  'email',
  'name',
  'displayname',
  'display_name',
  'phone',
  'address',
  'ip',
  'password',
  'token',
]);

const ACTION_SEGMENT = /^[a-z][a-zA-Z]{0,31}$/;

function isActionName(action: string): boolean {
  const segments = action.split('.');
  return (
    segments.length >= 2 &&
    segments.length <= 4 &&
    segments.every((segment) => ACTION_SEGMENT.test(segment))
  );
}

export class AuditMetadataError extends Error {
  constructor(key: string) {
    super(`audit metadata key "${key}" may hold personal data`);
    this.name = 'AuditMetadataError';
  }
}

export async function recordAudit(
  db: Database | Transaction,
  hash: KeyedHasher,
  entry: AuditEntry,
): Promise<void> {
  if (!isActionName(entry.action)) {
    throw new RangeError('audit action must be a dotted lower-camel name');
  }
  const metadata = entry.metadata ?? {};
  for (const key of Object.keys(metadata)) {
    if (PERSONAL_DATA_KEYS.has(key.toLowerCase())) {
      throw new AuditMetadataError(key);
    }
  }
  await db.insert(auditLogs).values({
    actorId: entry.actorId,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    ipHash: entry.ip === null ? null : hash('audit-ip', entry.ip),
    metadata,
  });
}
