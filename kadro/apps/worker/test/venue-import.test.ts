import { randomBytes } from 'node:crypto';

import { LIMITS, venueImportIssueSchema } from '@kadro/contracts';
import { type Database, auditLogs, districts, venueImports, venues } from '@kadro/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { enqueue } from '../src/enqueue.js';
import { parseCsv } from '../src/venues/csv.js';
import {
  checkHeader,
  createVenueImportHandler,
  importedVenueSlug,
  processVenueImport,
  validateRow,
} from '../src/venues/import.js';
import {
  type FakeProvider,
  Fixtures,
  MutableClock,
  type TestDatabase,
  type TestWorker,
  captureLogs,
  createTestDatabase,
  startFakeProvider,
  startTestWorker,
  waitForJobState,
} from './support.js';

/**
 * `venue.import` (ADR-0064 §6, ADR-0067): CSV reading, header and row validation, district
 * resolution, deduplication against the directory and within the file, dry runs, failure states,
 * the audit row, and idempotency, against a real database with the worker role's grants.
 */

let database: TestDatabase;
let provider: FakeProvider;
let worker: TestWorker;
let fixtures: Fixtures;
const clock = new MutableClock(new Date());
const db = (): Database => database.admin.db;

const HEADER = 'name,il,ilce,latitude,longitude,indoor';

interface District {
  readonly id: string;
  readonly ilSlug: string;
  readonly slug: string;
}

async function district(): Promise<District> {
  const code = randomBytes(3).toString('hex');
  const [row] = await db()
    .insert(districts)
    .values({
      il: `Deneme İl ${code}`,
      ilce: `Deneme İlçe ${code}`,
      ilSlug: `deneme-il-${code}`,
      slug: `deneme-ilce-${code}`,
      centroid: { lng: 29, lat: 41 },
    })
    .returning({ id: districts.id, ilSlug: districts.ilSlug, slug: districts.slug });
  if (!row) throw new Error('district insert returned no row');
  return row;
}

async function storeImport(csv: string, dryRun = false, createdBy: string | null = null) {
  const [row] = await db()
    .insert(venueImports)
    .values({ csv, dryRun, createdBy })
    .returning({ id: venueImports.id });
  if (!row) throw new Error('import insert returned no row');
  return row.id;
}

async function importRow(id: string) {
  const [row] = await db().select().from(venueImports).where(eq(venueImports.id, id));
  return row;
}

async function runThroughQueue(importId: string): Promise<void> {
  const jobId = await enqueue(worker.runtime.boss, 'venue.import', {
    importId,
    idempotencyKey: `venue-import:${importId}`,
  });
  await waitForJobState(database, 'venue.import', jobId ?? '', ['completed']);
}

beforeAll(async () => {
  database = await createTestDatabase('worker_venue_import');
  provider = await startFakeProvider();
  worker = await startTestWorker(database, provider, { clock });
  fixtures = new Fixtures(database.admin.db);
});

afterAll(async () => {
  await worker.runtime.stop();
  await provider.close();
  await database.dispose();
});

describe('CSV reading', () => {
  it('reads quoted fields, escaped quotes, line breaks inside quotes, CRLF and a BOM', () => {
    const parsed = parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n\r\n"two\nlines",z\n', 10);
    expect(parsed).toEqual({
      ok: true,
      records: [
        { line: 1, fields: ['a', 'b'] },
        { line: 2, fields: ['x, y', 'say "hi"'] },
        { line: 4, fields: ['two\nlines', 'z'] },
      ],
    });
  });

  it('refuses broken quoting and stops early on too many records', () => {
    expect(parseCsv('a,b\n"open,c\n', 10)).toMatchObject({
      ok: false,
      reason: 'unterminated_quote',
    });
    expect(parseCsv('a,b\nx"y,c\n', 10)).toMatchObject({
      ok: false,
      reason: 'invalid_quote',
      line: 2,
    });
    expect(parseCsv('a,b\n"x"y,c\n', 10)).toMatchObject({ ok: false, reason: 'invalid_quote' });
    expect(parseCsv('h\n1\n2\n3\n', 3)).toMatchObject({ ok: false, reason: 'too_many_rows' });
    expect(parseCsv('h\n1\n2\n', 3)).toMatchObject({ ok: true });
  });
});

describe('header and row validation', () => {
  it('requires the mandatory columns and refuses unknown or repeated ones', () => {
    expect(checkHeader(['indoor', 'name', 'ilce', 'il', 'longitude', 'latitude'])).toMatchObject({
      ok: true,
    });
    expect(checkHeader(['name', 'il'])).toMatchObject({
      ok: false,
      reason: 'missing_columns',
      issues: expect.arrayContaining([{ line: 1, column: 'latitude', issue: 'missing_column' }]),
    });
    expect(checkHeader([...HEADER.split(','), 'email'])).toMatchObject({
      ok: false,
      reason: 'unknown_columns',
      issues: [{ line: 1, column: null, issue: 'unknown_column' }],
    });
    expect(checkHeader([...HEADER.split(','), 'name'])).toMatchObject({
      ok: false,
      reason: 'duplicate_columns',
    });
  });

  it('reports the first problem of a row with its column and a contract-shaped code', () => {
    const header = checkHeader([
      ...HEADER.split(','),
      'phone',
      'price_min_minor',
      'price_max_minor',
      'shower',
    ]);
    if (!header.ok) throw new Error('header refused');
    const row = (values: string[]) => validateRow(header.columns, { line: 7, fields: values });
    const valid = ['Saha', 'izmir', 'bornova', '38.46', '27.21', 'true', '', '', '', ''];
    expect(row(valid)).toMatchObject({ name: 'Saha', indoor: true, features: {} });
    const cases: [string[], string | null, string][] = [
      [valid.slice(1), null, 'column_count'],
      [['', ...valid.slice(1)], 'name', 'required'],
      [['=HYPERLINK("x")', ...valid.slice(1)], 'name', 'formula_like'],
      [['[ÖRNEK] Saha', ...valid.slice(1)], 'name', 'reserved'],
      [['Saha', 'İzmir', ...valid.slice(2)], 'il', 'custom'],
      [['Saha', 'izmir', 'bornova', '1e3', ...valid.slice(4)], 'latitude', 'invalid_number'],
      [['Saha', 'izmir', 'bornova', '91', ...valid.slice(4)], 'latitude', 'out_of_range'],
      [[...valid.slice(0, 5), 'yes', ...valid.slice(6)], 'indoor', 'invalid_boolean'],
      [[...valid.slice(0, 6), 'phone-number', '', '', ''], 'phone', 'invalid_format'],
      [[...valid.slice(0, 7), '-5', '', ''], 'price_min_minor', 'invalid_integer'],
      [[...valid.slice(0, 7), '500', '100', ''], 'price_min_minor', 'price_range'],
      [[...valid.slice(0, 9), 'evet'], 'shower', 'invalid_boolean'],
    ];
    for (const [values, column, issue] of cases) {
      const result = row(values);
      expect(result, values.join('|')).toEqual({ line: 7, column, issue });
      expect(venueImportIssueSchema.safeParse(result).success).toBe(true);
    }
  });

  it('builds slugs like POST venues', () => {
    expect(importedVenueSlug('Çamlık Halı Saha', 'bornova', 0)).toBe('camlik-hali-saha-bornova');
    expect(importedVenueSlug('Çamlık Halı Saha', 'bornova', 1)).toMatch(
      /^camlik-hali-saha-bornova-[0-9a-f]{4}$/,
    );
  });
});

describe('venue.import job', () => {
  it('creates verified venues, skips duplicates, rejects bad rows and audits the run', async () => {
    const target = await district();
    const other = await district();
    const admin = await fixtures.user({ role: 'admin' });
    const tag = randomBytes(3).toString('hex');
    await db()
      .insert(venues)
      .values({
        name: `Mevcut Saha ${tag}`,
        slug: `mevcut-${tag}`,
        searchName: `mevcut saha ${tag}`,
        districtId: target.id,
        point: { lng: 29, lat: 41 },
        verified: true,
      });
    const csv = [
      `${HEADER},address,phone,lighting,changing_room,price_min_minor,price_max_minor`,
      `Yeni Saha ${tag},${target.ilSlug},${target.slug},41.01,29.02,false,"Moda Cad. 1, Kadıköy",+90 216 000 00 00,true,false,150000,250000`,
      `MEVCUT saha ${tag},${target.ilSlug},${target.slug},41.02,29.03,true,,,,,,`,
      `Yeni Saha ${tag},${other.ilSlug},${other.slug},41.03,29.04,true,,,,,,`,
      `yeni saha ${tag},${target.ilSlug},${target.slug},41.04,29.05,true,,,,,,`,
      `Kayıp Saha ${tag},${target.ilSlug},yok-boyle-ilce,41.05,29.06,true,,,,,,`,
      `Bozuk Saha ${tag},${target.ilSlug},${target.slug},abc,29.07,true,,,,,,`,
    ].join('\n');
    const importId = await storeImport(csv, false, admin.id);
    await runThroughQueue(importId);

    const row = await importRow(importId);
    expect(row).toMatchObject({
      status: 'completed',
      totalRows: 6,
      createdRows: 2,
      skippedRows: 2,
      rejectedRows: 2,
      failureReason: null,
    });
    expect(row?.startedAt).not.toBeNull();
    expect(row?.completedAt).not.toBeNull();
    expect(row?.issues).toEqual([
      { line: 7, column: 'latitude', issue: 'invalid_number' },
      { line: 6, column: 'ilce', issue: 'unknown_district' },
    ]);

    const created = await db()
      .select()
      .from(venues)
      .where(eq(venues.searchName, `yeni saha ${tag}`));
    expect(created).toHaveLength(2);
    const inTarget = created.find((venue) => venue.districtId === target.id);
    expect(inTarget).toMatchObject({
      name: `Yeni Saha ${tag}`,
      slug: `yeni-saha-${tag}-${target.slug}`,
      verified: true,
      isSample: false,
      createdBy: null,
      address: 'Moda Cad. 1, Kadıköy',
      phone: '+90 216 000 00 00',
      indoor: false,
      features: { lighting: true, changingRoom: false },
      priceMinMinor: 150_000,
      priceMaxMinor: 250_000,
      point: { lng: 29.02, lat: 41.01 },
    });

    const audit = await db()
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'venue.imported'), eq(auditLogs.targetId, importId)));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: admin.id,
      targetType: 'venue_import',
      metadata: {
        status: 'completed',
        dryRun: false,
        totalRows: 6,
        createdRows: 2,
        skippedRows: 2,
        rejectedRows: 2,
        failureReason: null,
      },
    });

    // A second run of the same import does nothing.
    expect(await processVenueImport({ db: db(), clock }, importId)).toBe('already_finished');
    expect(
      await db()
        .select()
        .from(venues)
        .where(eq(venues.searchName, `yeni saha ${tag}`)),
    ).toHaveLength(2);
  });

  it('validates a dry run without writing a venue', async () => {
    const target = await district();
    const tag = randomBytes(3).toString('hex');
    const csv = [
      HEADER,
      `Kuru Saha ${tag},${target.ilSlug},${target.slug},41.01,29.02,false`,
      `Kuru Saha ${tag},${target.ilSlug},${target.slug},41.01,29.02,false`,
      `,${target.ilSlug},${target.slug},41.01,29.02,false`,
    ].join('\r\n');
    const importId = await storeImport(csv, true);
    await runThroughQueue(importId);
    expect(await importRow(importId)).toMatchObject({
      status: 'completed',
      dryRun: true,
      totalRows: 3,
      createdRows: 0,
      skippedRows: 1,
      rejectedRows: 1,
      issues: [{ line: 4, column: 'name', issue: 'required' }],
    });
    expect(await db().select().from(venues).where(eq(venues.districtId, target.id))).toEqual([]);
  });

  it('fails an unreadable file with a reason and caps the issues at 50', async () => {
    const missing = await storeImport('name,il,ilce\nSaha,izmir,bornova\n');
    await runThroughQueue(missing);
    expect(await importRow(missing)).toMatchObject({
      status: 'failed',
      failureReason: 'missing_columns',
      totalRows: null,
      issues: [
        { line: 1, column: 'latitude', issue: 'missing_column' },
        { line: 1, column: 'longitude', issue: 'missing_column' },
        { line: 1, column: 'indoor', issue: 'missing_column' },
      ],
    });

    const tooMany = await storeImport(
      `${HEADER}\n${'x,y,z,1,2,true\n'.repeat(LIMITS.venueImportCsv.maxRows + 1)}`,
    );
    await runThroughQueue(tooMany);
    expect(await importRow(tooMany)).toMatchObject({
      status: 'failed',
      failureReason: 'too_many_rows',
      createdRows: 0,
    });

    const target = await district();
    const bad = `${HEADER}\n${`Saha,${target.ilSlug},${target.slug},x,29,true\n`.repeat(60)}`;
    const capped = await storeImport(bad);
    await runThroughQueue(capped);
    const row = await importRow(capped);
    expect(row).toMatchObject({ status: 'completed', totalRows: 60, rejectedRows: 60 });
    expect(row?.issues).toHaveLength(LIMITS.venueImportIssues.max);
  });

  it('answers missing_import for an unknown id and marks the import failed on the last attempt', async () => {
    expect(
      await processVenueImport({ db: db(), clock }, '018f2c1e-0000-7000-8000-0000000000aa'),
    ).toBe('missing_import');

    const importId = await storeImport(`${HEADER}\n`);
    const failing = new Proxy(db(), {
      get(target, property, receiver) {
        if (property === 'transaction') {
          return () => Promise.reject(new Error('database unavailable'));
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    const logs = captureLogs();
    const context = {
      jobId: 'job-1',
      queue: 'venue.import' as const,
      createdOn: new Date(),
      singletonKey: null,
      logger: logs.logger,
      signal: new AbortController().signal,
    };
    const handler = createVenueImportHandler({ db: failing, clock, retryLimit: 2 });
    const job = { importId, idempotencyKey: `venue-import:${importId}` };
    await expect(handler(job, { ...context, retryCount: 0 })).rejects.toThrow();
    expect((await importRow(importId))?.status).toBe('processing');
    await expect(handler(job, { ...context, retryCount: 2 })).rejects.toThrow();
    expect(await importRow(importId)).toMatchObject({
      status: 'failed',
      failureReason: 'internal_error',
    });
  });
});
