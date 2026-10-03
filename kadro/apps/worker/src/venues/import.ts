import { randomBytes } from 'node:crypto';

import {
  foldTr,
  geoPointSchema,
  LIMITS,
  slugSchema,
  VENUE_IMPORT_COLUMNS,
  VENUE_IMPORT_REQUIRED_COLUMNS,
  type VenueFeatures,
  type VenueImportColumn,
  type VenueImportIssue,
  type VenueImportJob,
  venuePhoneSchema,
  visibleTextSchema,
} from '@kadro/contracts';
import {
  auditLogs,
  type Database,
  districts,
  setLockTimeout,
  type Transaction,
  venueImports,
  venues,
} from '@kadro/db';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { type z } from 'zod';

import { type Clock } from '../clock.js';
import { type JobContext } from '../job-runner.js';
import { type CsvRecord, parseCsv } from './csv.js';

/**
 * `venue.import` (ADR-0064 §6, ADR-0067). The web app stored the CSV in `venue_imports` and
 * enqueued the import id; this handler:
 *
 * 1. claims the import (`queued` → `processing`, `started_at`);
 * 2. in one transaction holding the import row: parses the CSV, checks the header (required
 *    columns present, no unknown or repeated column), validates every row with the contract
 *    schemas, resolves `il` / `ilce` slugs to districts, locks those district rows (the lock
 *    `POST venues` takes) and skips rows whose folded name already exists in their district, in
 *    the database or earlier in the file;
 * 3. unless `dry_run`, inserts the remaining rows as verified, non-sample venues without a
 *    creator, with a slug derived on the server;
 * 4. stores the counters and at most 50 issues, sets `completed` (or `failed` for a file that
 *    cannot be read: malformed quoting, bad header, more than 5 000 rows) and writes one
 *    `venue.imported` audit row with counts only.
 *
 * Idempotent by state: a finished import is never processed again, and a crashed run rolled back
 * everything it wrote. When the last retry fails, the import is marked `failed`
 * (`internal_error`) so it never stays `processing`.
 */

export interface VenueImportDependencies {
  readonly db: Database;
  readonly clock: Clock;
  /** Retry limit of the queue; on the last attempt a failure marks the import `failed`. */
  readonly retryLimit: number;
}

export type VenueImportOutcome = 'completed' | 'failed' | 'already_finished' | 'missing_import';

const MAX_ISSUES = LIMITS.venueImportIssues.max;
const MAX_ROWS = LIMITS.venueImportCsv.maxRows;
const SAMPLE_PREFIX = foldTr('[ÖRNEK]');
/** Leading characters a spreadsheet would evaluate (CSV formula injection, T-VEN-06). */
const FORMULA_START = /^[=+\-@\t\r]/;

const NAME_SCHEMA = visibleTextSchema(LIMITS.venueName.min, LIMITS.venueName.max);
const ADDRESS_SCHEMA = visibleTextSchema(1, LIMITS.venueAddress.max);
const INTEGER_TEXT = /^\d{1,12}$/;
const SIGNED_DIGITS = /^-?\d{1,3}$/;
const FRACTION_DIGITS = /^\d{1,12}$/;

/** Plain decimal degrees such as `41.0082` or `-8.5`: no exponent, sign only in front. */
function isDecimalText(value: string): boolean {
  const [whole = '', fraction, ...rest] = value.split('.');
  return (
    rest.length === 0 &&
    SIGNED_DIGITS.test(whole) &&
    (fraction === undefined || FRACTION_DIGITS.test(fraction))
  );
}
const PRICE_MAX = LIMITS.feeTotalMinor.max;

const FEATURE_COLUMNS = {
  lighting: 'lighting',
  changing_room: 'changingRoom',
  shower: 'shower',
  parking: 'parking',
} as const satisfies Partial<Record<VenueImportColumn, keyof VenueFeatures>>;

// ---------------------------------------------------------------------------
// Row validation
// ---------------------------------------------------------------------------

export interface VenueCandidate {
  readonly line: number;
  readonly name: string;
  readonly searchName: string;
  readonly ilSlug: string;
  readonly ilceSlug: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly address: string | null;
  readonly phone: string | null;
  readonly indoor: boolean;
  readonly features: VenueFeatures;
  readonly priceMinMinor: number | null;
  readonly priceMaxMinor: number | null;
}

class RowIssue extends Error {
  constructor(
    readonly column: VenueImportColumn | null,
    readonly issue: string,
  ) {
    super(issue);
    this.name = 'RowIssue';
  }
}

export type HeaderResult =
  | { readonly ok: true; readonly columns: readonly VenueImportColumn[] }
  | { readonly ok: false; readonly reason: string; readonly issues: VenueImportIssue[] };

function isImportColumn(value: string): value is VenueImportColumn {
  return (VENUE_IMPORT_COLUMNS as readonly string[]).includes(value);
}

/** Header row: every required column, no unknown or repeated name (any order). */
export function checkHeader(fields: readonly string[]): HeaderResult {
  const columns: VenueImportColumn[] = [];
  const issues: VenueImportIssue[] = [];
  let unknown = false;
  let repeated = false;
  for (const raw of fields) {
    const name = raw.trim();
    if (!isImportColumn(name)) {
      unknown = true;
      issues.push({ line: 1, column: null, issue: 'unknown_column' });
      continue;
    }
    if (columns.includes(name)) {
      repeated = true;
      issues.push({ line: 1, column: name, issue: 'duplicate_column' });
      continue;
    }
    columns.push(name);
  }
  const missing = VENUE_IMPORT_REQUIRED_COLUMNS.filter((column) => !columns.includes(column));
  for (const column of missing) {
    issues.push({ line: 1, column, issue: 'missing_column' });
  }
  if (missing.length > 0 || unknown || repeated) {
    const reason =
      missing.length > 0 ? 'missing_columns' : unknown ? 'unknown_columns' : 'duplicate_columns';
    return { ok: false, reason, issues: issues.slice(0, MAX_ISSUES) };
  }
  return { ok: true, columns };
}

function zodIssue(error: z.ZodError): string {
  const code = error.issues[0]?.code ?? 'invalid';
  return /^[a-z][a-z_]{0,63}$/.test(code) ? code : 'invalid';
}

function text<T>(column: VenueImportColumn, schema: z.ZodType<T>, value: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new RowIssue(column, zodIssue(parsed.error));
  }
  return parsed.data;
}

function optionalText<T>(column: VenueImportColumn, schema: z.ZodType<T>, value: string): T | null {
  return value.trim() === '' ? null : text(column, schema, value);
}

function decimal(column: VenueImportColumn, value: string): number {
  const trimmed = value.trim();
  if (!isDecimalText(trimmed)) {
    throw new RowIssue(column, 'invalid_number');
  }
  return Number(trimmed);
}

function bool(column: VenueImportColumn, value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === 'true') {
    return true;
  }
  if (trimmed === 'false') {
    return false;
  }
  throw new RowIssue(column, 'invalid_boolean');
}

function optionalPrice(column: VenueImportColumn, value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }
  if (!INTEGER_TEXT.test(trimmed)) {
    throw new RowIssue(column, 'invalid_integer');
  }
  const price = Number(trimmed);
  if (price > PRICE_MAX) {
    throw new RowIssue(column, 'too_big');
  }
  return price;
}

function rejectFormula(column: VenueImportColumn, value: string): void {
  if (FORMULA_START.test(value)) {
    throw new RowIssue(column, 'formula_like');
  }
}

/**
 * One data row → a candidate venue, or the first problem as `{ column, issue }`. Every value is
 * validated with the same schema as `POST venues`.
 */
export function validateRow(
  columns: readonly VenueImportColumn[],
  record: CsvRecord,
): VenueCandidate | VenueImportIssue {
  if (record.fields.length !== columns.length) {
    return { line: record.line, column: null, issue: 'column_count' };
  }
  const cell = (column: VenueImportColumn): string => {
    const index = columns.indexOf(column);
    return index < 0 ? '' : (record.fields.at(index) ?? '');
  };
  try {
    for (const column of VENUE_IMPORT_REQUIRED_COLUMNS) {
      if (cell(column).trim() === '') {
        throw new RowIssue(column, 'required');
      }
    }
    rejectFormula('name', cell('name').trim());
    rejectFormula('address', cell('address').trim());
    const name = text('name', NAME_SCHEMA, cell('name'));
    const searchName = foldTr(name);
    if (searchName.startsWith(SAMPLE_PREFIX)) {
      throw new RowIssue('name', 'reserved');
    }
    const ilSlug = text('il', slugSchema, cell('il').trim());
    const ilceSlug = text('ilce', slugSchema, cell('ilce').trim());
    const latitude = decimal('latitude', cell('latitude'));
    const longitude = decimal('longitude', cell('longitude'));
    if (!geoPointSchema.shape.latitude.safeParse(latitude).success) {
      throw new RowIssue('latitude', 'out_of_range');
    }
    if (!geoPointSchema.shape.longitude.safeParse(longitude).success) {
      throw new RowIssue('longitude', 'out_of_range');
    }
    const address = optionalText('address', ADDRESS_SCHEMA, cell('address'));
    const phone = optionalText('phone', venuePhoneSchema, cell('phone'));
    const indoor = bool('indoor', cell('indoor'));
    const features: Record<string, boolean> = {};
    for (const [column, key] of Object.entries(FEATURE_COLUMNS) as [
      keyof typeof FEATURE_COLUMNS,
      keyof VenueFeatures,
    ][]) {
      const value = cell(column);
      if (value.trim() !== '') {
        // eslint-disable-next-line security/detect-object-injection -- key comes from a literal map
        features[key] = bool(column, value);
      }
    }
    const priceMinMinor = optionalPrice('price_min_minor', cell('price_min_minor'));
    const priceMaxMinor = optionalPrice('price_max_minor', cell('price_max_minor'));
    if (priceMinMinor !== null && priceMaxMinor !== null && priceMinMinor > priceMaxMinor) {
      throw new RowIssue('price_min_minor', 'price_range');
    }
    return {
      line: record.line,
      name,
      searchName,
      ilSlug,
      ilceSlug,
      latitude,
      longitude,
      address,
      phone,
      indoor,
      features,
      priceMinMinor,
      priceMaxMinor,
    };
  } catch (error) {
    if (error instanceof RowIssue) {
      return { line: record.line, column: error.column, issue: error.issue };
    }
    throw error;
  }
}

function isCandidate(value: VenueCandidate | VenueImportIssue): value is VenueCandidate {
  return 'searchName' in value;
}

// ---------------------------------------------------------------------------
// Slugs (same scheme as `POST venues`, ADR-0038)
// ---------------------------------------------------------------------------

const NAME_SLUG_MAX = 50;
const SLUG_MAX = 80;
const SLUG_ATTEMPTS = 5;

function slugPart(value: string): string {
  return foldTr(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** `<folded name>-<district slug>`, then a random 16-bit suffix after a collision. */
export function importedVenueSlug(name: string, districtSlug: string, attempt: number): string {
  const base = slugPart(name).slice(0, NAME_SLUG_MAX).replace(/-+$/g, '') || 'saha';
  const stem = `${base}-${districtSlug}`.slice(0, SLUG_MAX - 5).replace(/-+$/g, '');
  return attempt === 0 ? stem : `${stem}-${randomBytes(2).toString('hex')}`;
}

function isSlugCollision(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    const fields = current as { code?: unknown; constraint?: unknown };
    if (fields.code === '23505' && fields.constraint === 'venues_slug_key') {
      return true;
    }
    current = current.cause;
  }
  return false;
}

async function insertVenue(
  tx: Transaction,
  candidate: VenueCandidate,
  district: { readonly id: string; readonly slug: string },
  now: Date,
): Promise<void> {
  for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt += 1) {
    try {
      // Savepoint per attempt: a slug collision rolls back only this insert.
      await tx.transaction(async (savepoint) => {
        await savepoint.insert(venues).values({
          name: candidate.name,
          slug: importedVenueSlug(candidate.name, district.slug, attempt),
          searchName: candidate.searchName,
          districtId: district.id,
          point: { lng: candidate.longitude, lat: candidate.latitude },
          address: candidate.address,
          phone: candidate.phone,
          indoor: candidate.indoor,
          features: candidate.features,
          priceMinMinor: candidate.priceMinMinor,
          priceMaxMinor: candidate.priceMaxMinor,
          verified: true,
          isSample: false,
          createdBy: null,
          createdAt: now,
          updatedAt: now,
        });
      });
      return;
    } catch (error) {
      if (!isSlugCollision(error)) {
        throw error;
      }
    }
  }
  throw new Error('venue slug attempts exhausted');
}

// ---------------------------------------------------------------------------
// Processing
// ---------------------------------------------------------------------------

interface ImportSummary {
  readonly status: 'completed' | 'failed';
  readonly failureReason: string | null;
  readonly totalRows: number | null;
  readonly createdRows: number;
  readonly skippedRows: number;
  readonly rejectedRows: number;
  readonly issues: VenueImportIssue[];
}

function failed(reason: string, issues: VenueImportIssue[] = []): ImportSummary {
  return {
    status: 'failed',
    failureReason: reason,
    totalRows: null,
    createdRows: 0,
    skippedRows: 0,
    rejectedRows: 0,
    issues: issues.slice(0, MAX_ISSUES),
  };
}

function districtKey(ilSlug: string, slug: string): string {
  return `${ilSlug}/${slug}`;
}

function venueKey(districtId: string, searchName: string): string {
  return `${districtId}\n${searchName}`;
}

async function importRows(
  tx: Transaction,
  csv: string,
  dryRun: boolean,
  now: Date,
): Promise<ImportSummary> {
  const parsed = parseCsv(csv, MAX_ROWS + 1);
  if (!parsed.ok) {
    return failed(parsed.reason, [{ line: parsed.line, column: null, issue: parsed.reason }]);
  }
  const [header, ...rows] = parsed.records;
  if (header === undefined) {
    return failed('missing_header', [{ line: 1, column: null, issue: 'missing_header' }]);
  }
  if (header.line !== 1) {
    return failed('missing_header', [{ line: header.line, column: null, issue: 'missing_header' }]);
  }
  const checked = checkHeader(header.fields);
  if (!checked.ok) {
    return failed(checked.reason, checked.issues);
  }

  const issues: VenueImportIssue[] = [];
  const addIssue = (issue: VenueImportIssue): void => {
    if (issues.length < MAX_ISSUES) {
      issues.push(issue);
    }
  };
  const candidates: VenueCandidate[] = [];
  let rejected = 0;
  for (const record of rows) {
    const result = validateRow(checked.columns, record);
    if (isCandidate(result)) {
      candidates.push(result);
    } else {
      rejected += 1;
      addIssue(result);
    }
  }

  // District slugs → rows, then the district row locks of `POST venues`, in id order.
  const ilSlugs = [...new Set(candidates.map((candidate) => candidate.ilSlug))];
  const known =
    ilSlugs.length === 0
      ? []
      : await tx
          .select({ id: districts.id, ilSlug: districts.ilSlug, slug: districts.slug })
          .from(districts)
          .where(inArray(districts.ilSlug, ilSlugs));
  const byKey = new Map(known.map((row) => [districtKey(row.ilSlug, row.slug), row]));
  const resolved: { candidate: VenueCandidate; district: { id: string; slug: string } }[] = [];
  for (const candidate of candidates) {
    const district = byKey.get(districtKey(candidate.ilSlug, candidate.ilceSlug));
    if (district === undefined) {
      rejected += 1;
      addIssue({ line: candidate.line, column: 'ilce', issue: 'unknown_district' });
      continue;
    }
    resolved.push({ candidate, district });
  }
  const districtIds = [...new Set(resolved.map((entry) => entry.district.id))].sort();
  if (districtIds.length > 0) {
    await tx
      .select({ id: districts.id })
      .from(districts)
      .where(inArray(districts.id, districtIds))
      .orderBy(asc(districts.id))
      .for('no key update');
  }
  const existing =
    districtIds.length === 0
      ? []
      : await tx
          .select({ districtId: venues.districtId, searchName: venues.searchName })
          .from(venues)
          .where(inArray(venues.districtId, districtIds));
  const taken = new Set(existing.map((row) => venueKey(row.districtId, row.searchName)));

  let created = 0;
  let skipped = 0;
  for (const { candidate, district } of resolved) {
    const key = venueKey(district.id, candidate.searchName);
    if (taken.has(key)) {
      skipped += 1;
      continue;
    }
    taken.add(key);
    if (!dryRun) {
      await insertVenue(tx, candidate, district, now);
      created += 1;
    }
  }
  return {
    status: 'completed',
    failureReason: null,
    totalRows: rows.length,
    createdRows: created,
    skippedRows: skipped,
    rejectedRows: rejected,
    issues,
  };
}

/** `queued` (or a crashed `processing`) → `processing`; `false` when there is nothing to run. */
async function claim(db: Database, importId: string, now: Date): Promise<boolean> {
  const rows = await db
    .update(venueImports)
    .set({ status: 'processing', startedAt: now, updatedAt: now })
    .where(
      and(eq(venueImports.id, importId), inArray(venueImports.status, ['queued', 'processing'])),
    )
    .returning({ id: venueImports.id });
  return rows.length > 0;
}

async function finishedOrMissing(
  db: Database,
  importId: string,
): Promise<'already_finished' | 'missing_import'> {
  const [row] = await db
    .select({ id: venueImports.id })
    .from(venueImports)
    .where(eq(venueImports.id, importId))
    .limit(1);
  return row === undefined ? 'missing_import' : 'already_finished';
}

export async function processVenueImport(
  dependencies: Pick<VenueImportDependencies, 'db' | 'clock'>,
  importId: string,
): Promise<VenueImportOutcome> {
  const { db, clock } = dependencies;
  if (!(await claim(db, importId, clock.now()))) {
    return finishedOrMissing(db, importId);
  }
  return db.transaction(async (tx) => {
    await setLockTimeout(tx);
    const [row] = await tx
      .select({
        csv: venueImports.csv,
        dryRun: venueImports.dryRun,
        status: venueImports.status,
        createdBy: venueImports.createdBy,
      })
      .from(venueImports)
      .where(eq(venueImports.id, importId))
      .for('update');
    if (row === undefined) {
      return 'missing_import';
    }
    if (row.status !== 'processing') {
      return 'already_finished';
    }
    const now = clock.now();
    const summary = await importRows(tx, row.csv, row.dryRun, now);
    await tx
      .update(venueImports)
      .set({
        status: summary.status,
        failureReason: summary.failureReason,
        totalRows: summary.totalRows,
        createdRows: summary.createdRows,
        skippedRows: summary.skippedRows,
        rejectedRows: summary.rejectedRows,
        issues: summary.issues,
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(venueImports.id, importId));
    await tx.insert(auditLogs).values({
      actorId: row.createdBy,
      action: 'venue.imported',
      targetType: 'venue_import',
      targetId: importId,
      metadata: {
        status: summary.status,
        dryRun: row.dryRun,
        totalRows: summary.totalRows,
        createdRows: summary.createdRows,
        skippedRows: summary.skippedRows,
        rejectedRows: summary.rejectedRows,
        failureReason: summary.failureReason,
      },
    });
    return summary.status;
  });
}

/** Marks an import that is still open as `failed` after its last attempt. */
async function markFailed(db: Database, importId: string, now: Date): Promise<void> {
  await db
    .update(venueImports)
    .set({
      status: 'failed',
      failureReason: 'internal_error',
      completedAt: now,
      updatedAt: now,
    })
    .where(
      and(eq(venueImports.id, importId), inArray(venueImports.status, ['queued', 'processing'])),
    );
}

export function createVenueImportHandler(dependencies: VenueImportDependencies) {
  return async (job: VenueImportJob, context: JobContext): Promise<string> => {
    try {
      const outcome = await processVenueImport(dependencies, job.importId);
      context.logger.info({ outcome }, 'venue import processed');
      return outcome;
    } catch (error) {
      if (context.retryCount >= dependencies.retryLimit) {
        await markFailed(dependencies.db, job.importId, dependencies.clock.now()).catch(
          () => undefined,
        );
      }
      throw error;
    }
  };
}
