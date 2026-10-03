import {
  type VenueImport,
  venueImportIssueSchema,
  type VenueImportRequest,
} from '@kadro/contracts';
import { venueImports } from '@kadro/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { recordAudit } from '../audit';
import { type DbReader } from '../domain/relations';
import { ApiError } from '../errors';
import { actorIdOf } from '../teams/context';
import { type AdminRequest } from './step-up';

/**
 * Venue CSV import, web side (`POST admin/venues/import`, `GET admin/venues/import/:importId`;
 * ADR-0064 §6, ADR-0067). The handler only stores the CSV and enqueues `venue.import` in the same
 * transaction; parsing, validation, deduplication and the inserts run in the worker. The CSV is
 * never returned.
 */

/** Idempotency key of the import job: one job per stored import. */
export function venueImportJobKey(importId: string): string {
  return `venue-import:${importId}`;
}

const IMPORT_COLUMNS = {
  id: venueImports.id,
  status: venueImports.status,
  dryRun: venueImports.dryRun,
  totalRows: venueImports.totalRows,
  createdRows: venueImports.createdRows,
  skippedRows: venueImports.skippedRows,
  rejectedRows: venueImports.rejectedRows,
  issues: venueImports.issues,
  createdAt: venueImports.createdAt,
  completedAt: venueImports.completedAt,
};

interface ImportRow {
  readonly id: string;
  readonly status: VenueImport['status'];
  readonly dryRun: boolean;
  readonly totalRows: number | null;
  readonly createdRows: number;
  readonly skippedRows: number;
  readonly rejectedRows: number;
  readonly issues: unknown;
  readonly createdAt: Date;
  readonly completedAt: Date | null;
}

const storedIssuesSchema = z.array(venueImportIssueSchema);

function toVenueImport(row: ImportRow): VenueImport {
  const issues = storedIssuesSchema.safeParse(row.issues);
  return {
    id: row.id,
    status: row.status,
    dryRun: row.dryRun,
    totalRows: row.totalRows,
    createdRows: row.createdRows,
    skippedRows: row.skippedRows,
    rejectedRows: row.rejectedRows,
    // The worker writes only contract-shaped issues; anything else is dropped, never echoed.
    issues: issues.success ? issues.data : [],
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt === null ? null : row.completedAt.toISOString(),
  };
}

async function loadImport(db: DbReader, importId: string): Promise<VenueImport | null> {
  const [row] = await db
    .select(IMPORT_COLUMNS)
    .from(venueImports)
    .where(eq(venueImports.id, importId))
    .limit(1);
  return row === undefined ? null : toVenueImport(row);
}

/**
 * `POST admin/venues/import` (`venue.import`, admin + step-up): stores the CSV as a `queued`
 * import, enqueues `venue.import` (key `venue-import:<id>`) and writes one
 * `venue.importRequested` audit row with the size and the dry-run flag, all in one transaction.
 */
export async function requestVenueImport(
  { ctx, runtime }: AdminRequest,
  body: VenueImportRequest,
): Promise<VenueImport> {
  await ctx.authorize('venue.import');
  const actorId = actorIdOf(ctx);
  return runtime.db.transaction(async (tx) => {
    const now = runtime.now();
    const [row] = await tx
      .insert(venueImports)
      .values({
        createdBy: actorId,
        csv: body.csv,
        dryRun: body.dryRun,
        createdAt: now,
        updatedAt: now,
      })
      .returning(IMPORT_COLUMNS);
    if (row === undefined) {
      throw new Error('venue import insert returned no row');
    }
    await runtime.jobs.enqueue(
      tx,
      'venue.import',
      { importId: row.id },
      { idempotencyKey: venueImportJobKey(row.id) },
    );
    await recordAudit(tx, runtime.keyedHash, {
      actorId,
      action: 'venue.importRequested',
      targetType: 'venue_import',
      targetId: row.id,
      ip: ctx.ip,
      metadata: { dryRun: body.dryRun, csvChars: body.csv.length },
    });
    return toVenueImport(row);
  });
}

/** `GET admin/venues/import/:importId` (`admin.read`): the import state; unknown id → 404. */
export async function getVenueImport(
  { ctx, runtime }: AdminRequest,
  importId: string,
): Promise<VenueImport> {
  await ctx.authorize('admin.read');
  const state = await loadImport(runtime.db, importId);
  if (state === null) {
    throw new ApiError('not_found');
  }
  return state;
}
