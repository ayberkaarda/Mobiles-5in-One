import { randomUUID } from 'node:crypto';

import { idSchema } from '@kadro/contracts';
import { auditLogs, districts, matches, teams, users } from '@kadro/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { AuditMetadataError, recordAudit } from '../lib/server/audit';
import { json, route } from '../lib/server/http';
import { createKeyedHasher } from '../lib/server/keyed-hash';
import { noQuery } from '../lib/server/validate';
import { createMigratedDatabase, type TestDatabase } from './support/db';
import { call, expectProblem, MOBILE } from './support/http';
import { installTestRuntime, type TestRuntime } from './support/runtime';

let database: TestDatabase;
let harness: TestRuntime;
let ownerId: string;
let teamId: string;

beforeAll(async () => {
  database = await createMigratedDatabase('web_database');
  harness = await installTestRuntime({ db: database.client.db });
  const db = database.client.db;
  const [district] = await db
    .insert(districts)
    .values({
      il: 'Ankara',
      ilce: 'Çankaya',
      ilSlug: 'ankara',
      slug: 'cankaya',
      centroid: { lng: 32.86, lat: 39.9 },
    })
    .returning({ id: districts.id });
  const [owner] = await db
    .insert(users)
    .values({ email: `owner-${randomUUID()}@example.test`, displayName: 'Kaptan' })
    .returning({ id: users.id });
  ownerId = owner?.id ?? '';
  const [team] = await db
    .insert(teams)
    .values({ name: 'Çankaya FK', slug: 'cankaya-fk', districtId: district?.id ?? '', ownerId })
    .returning({ id: teams.id });
  teamId = team?.id ?? '';
});

afterAll(async () => {
  await database.dispose();
});

describe('database constraint errors become safe problem codes', () => {
  /** Changes the fee directly, letting the ADR-0004 trigger be the only guard. */
  const changeFee = route({
    path: '/api/v1/test/matches/[id]',
    method: 'PATCH',
    auth: 'none',
    params: z.strictObject({ id: idSchema }),
    query: noQuery,
    body: z.strictObject({ feeTotalMinor: z.number().int().min(0) }),
    handler: async ({ params, body, runtime }) => {
      await runtime.db
        .update(matches)
        .set({ feeTotalMinor: body.feeTotalMinor })
        .where(eq(matches.id, params.id));
      return json({ ok: true });
    },
  });

  it('maps the matches_terms_frozen trigger (SQLSTATE 23514) to 409 match_terms_frozen', async () => {
    const [match] = await database.client.db
      .insert(matches)
      .values({
        teamId,
        startsAt: new Date(Date.now() + 86_400_000),
        format: '7v7',
        feeTotalMinor: 140_000,
        slots: 14,
        status: 'locked',
        lockedAt: new Date(),
      })
      .returning({ id: matches.id });
    const id = match?.id ?? '';

    const response = await call(changeFee, {
      method: 'PATCH',
      headers: MOBILE,
      params: { id },
      json: { feeTotalMinor: 1 },
    });
    const text = await response.clone().text();
    await expectProblem(response, 409, 'match_terms_frozen');
    for (const leak of [
      'matches_terms_frozen',
      'update',
      'fee_total_minor',
      '140000',
      'frozen after',
    ]) {
      expect(text).not.toContain(leak);
    }

    const [row] = await database.client.db
      .select({ fee: matches.feeTotalMinor })
      .from(matches)
      .where(eq(matches.id, id));
    expect(row?.fee).toBe(140_000);
  });

  it('allows the same change before the first lock', async () => {
    const [match] = await database.client.db
      .insert(matches)
      .values({ teamId, startsAt: new Date(Date.now() + 86_400_000), format: '5v5', slots: 10 })
      .returning({ id: matches.id });
    const response = await call(changeFee, {
      method: 'PATCH',
      headers: MOBILE,
      params: { id: match?.id ?? '' },
      json: { feeTotalMinor: 50_000 },
    });
    expect(response.status).toBe(200);
  });

  it('maps a unique violation to 409 conflict without naming the constraint', async () => {
    const duplicateTeam = route({
      path: '/api/v1/test/teams',
      method: 'POST',
      auth: 'none',
      params: z.strictObject({}),
      query: noQuery,
      body: z.strictObject({ slug: z.string() }),
      handler: async ({ body, runtime }) => {
        const [existing] = await runtime.db.select().from(teams).where(eq(teams.id, teamId));
        await runtime.db.insert(teams).values({
          name: 'Kopya',
          slug: body.slug,
          districtId: existing?.districtId ?? '',
          ownerId,
        });
        return json({ ok: true });
      },
    });
    const response = await call(duplicateTeam, {
      method: 'POST',
      headers: MOBILE,
      json: { slug: 'cankaya-fk' },
    });
    const text = await response.clone().text();
    await expectProblem(response, 409, 'conflict');
    expect(text).not.toContain('teams_slug_key');
    expect(text).not.toContain('cankaya-fk');
  });
});

describe('recordAudit', () => {
  it('stores a keyed hash of the address and no personal data', async () => {
    await recordAudit(database.client.db, harness.runtime.keyedHash, {
      actorId: ownerId,
      action: 'payment.mark',
      targetType: 'match_rsvp',
      targetId: teamId,
      ip: '203.0.113.7',
      metadata: { paid: true },
    });
    const [row] = await database.client.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.actorId, ownerId));
    expect(row?.ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.ipHash).not.toContain('203.0.113.7');
    expect(row?.ipHash).toBe(harness.runtime.keyedHash('audit-ip', '203.0.113.7'));
    expect(row?.ipHash).not.toBe(harness.runtime.keyedHash('rate-limit', '203.0.113.7'));
    expect(row?.ipHash).toBe(createKeyedHasher(harness.env.HASH_SECRET)('audit-ip', '203.0.113.7'));
    expect(row?.ipHash).not.toBe(
      createKeyedHasher(harness.env.CSRF_SECRET)('audit-ip', '203.0.113.7'),
    );
    expect(row?.metadata).toEqual({ paid: true });
  });

  it('refuses metadata keys that usually carry personal data', async () => {
    for (const key of ['email', 'displayName', 'IP', 'phone']) {
      await expect(
        recordAudit(database.client.db, harness.runtime.keyedHash, {
          actorId: ownerId,
          action: 'admin.role.manage',
          targetType: 'user',
          targetId: ownerId,
          ip: null,
          metadata: { [key]: 'x' },
        }),
      ).rejects.toBeInstanceOf(AuditMetadataError);
    }
  });

  it('refuses malformed action names', async () => {
    await expect(
      recordAudit(database.client.db, harness.runtime.keyedHash, {
        actorId: null,
        action: 'DROP TABLE',
        targetType: 'user',
        targetId: null,
        ip: null,
      }),
    ).rejects.toBeInstanceOf(RangeError);
  });
});
