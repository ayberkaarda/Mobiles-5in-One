import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

/**
 * Sample data for the mobile screenshots (ops/take-mobile-screenshots.sh), created through the
 * public API of a running local stack (see apps/mobile/e2e/README.md, section 1).
 *
 * Every display name and team name starts with `[ÖRNEK]`; email addresses are
 * `ornek-<role>-<run>@example.com`. Accounts are fresh per run. One statement has no API: marking
 * this run's addresses as verified, through `psql` in the database container, limited to this run.
 *
 * Prints `KEY=value` lines (the run's password is random and only printed, never stored here).
 *
 * Environment: KADRO_SHOTS_API_URL (default http://localhost:3000), KADRO_SHOTS_DB_CONTAINER (a
 * container name; default: the compose `postgres` service), POSTGRES_USER / POSTGRES_DB (kadro).
 */

// eslint-disable-next-line no-restricted-properties -- ops tooling, not application configuration
const env = process.env;
const API = env.KADRO_SHOTS_API_URL ?? 'http://localhost:3000';
const DB_USER = env.POSTGRES_USER ?? 'kadro';
const DB_NAME = env.POSTGRES_DB ?? 'kadro';
const DB_CONTAINER = env.KADRO_SHOTS_DB_CONTAINER ?? '';
const DAY_MS = 86_400_000;
const SAMPLE_VENUE_SLUG = 'ornek-kadikoy-hali-saha-a';

if (!/^[A-Za-z0-9_]+$/u.test(DB_USER) || !/^[A-Za-z0-9_]+$/u.test(DB_NAME)) {
  throw new Error('POSTGRES_USER and POSTGRES_DB must be plain identifiers');
}
if (DB_CONTAINER !== '' && !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/u.test(DB_CONTAINER)) {
  throw new Error('KADRO_SHOTS_DB_CONTAINER must be a container name');
}

const run = randomBytes(3).toString('hex');
const password = `Kd-${randomBytes(15).toString('base64url')}-9a`;

async function request(path, { method = 'GET', token, body, expect = [200, 201, 202] } = {}) {
  const response = await fetch(new URL(path, API), {
    method,
    headers: {
      accept: 'application/json, application/problem+json',
      'x-kadro-client': 'mobile',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'error',
  });
  const text = await response.text();
  if (!expect.includes(response.status)) {
    throw new Error(`${method} ${path} answered ${String(response.status)}`);
  }
  return text === '' ? null : JSON.parse(text);
}

function psql(sqlText) {
  const target =
    DB_CONTAINER === '' ? ['compose', 'exec', '-T', 'postgres'] : ['exec', DB_CONTAINER];
  return execFileSync(
    'docker',
    [
      ...target,
      'psql',
      '-X',
      '-q',
      '-A',
      '-t',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      DB_USER,
      '-d',
      DB_NAME,
      '-c',
      sqlText,
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  ).trim();
}

const district = (slug) =>
  psql(`SELECT id FROM districts WHERE il_slug = 'istanbul' AND slug = '${slug}'`);

const people = [
  { role: 'captain', name: '[ÖRNEK] Deniz Kaptan', position: 'MID', level: 'regular' },
  { role: 'p1', name: '[ÖRNEK] Ali Kaleci', position: 'GK', level: 'regular' },
  { role: 'p2', name: '[ÖRNEK] Can Defans', position: 'DEF', level: 'casual' },
  { role: 'p3', name: '[ÖRNEK] Ece Orta', position: 'MID', level: 'competitive' },
  { role: 'p4', name: '[ÖRNEK] Mert Forvet', position: 'FWD', level: 'regular' },
  { role: 'p5', name: '[ÖRNEK] Selin Bek', position: 'DEF', level: 'regular' },
  { role: 'host', name: '[ÖRNEK] Ozan Organizatör', position: 'MID', level: 'casual' },
  { role: 'empty', name: '[ÖRNEK] Yeni Oyuncu', position: null, level: null },
];
const email = (role) => `ornek-${role}-${run}@example.com`;

async function main() {
  await request('/api/v1/health');
  for (const person of people) {
    await request('/api/v1/auth/register', {
      method: 'POST',
      body: { email: email(person.role), password, displayName: person.name },
    });
  }
  psql(
    `UPDATE users SET email_verified_at = now() WHERE email LIKE 'ornek-%-${run}@example.com' AND email_verified_at IS NULL`,
  );
  const kadikoy = district('kadikoy');
  const besiktas = district('besiktas');
  if (!/^[0-9a-f-]{36}$/u.test(kadikoy) || !/^[0-9a-f-]{36}$/u.test(besiktas)) {
    throw new Error('districts missing; run `pnpm --filter @kadro/db db:seed` first');
  }

  const tokens = new Map();
  for (const person of people) {
    const session = await request('/api/v1/auth/login', {
      method: 'POST',
      body: { email: email(person.role), password },
    });
    tokens.set(person.role, session.tokens.accessToken);
    if (person.role !== 'empty') {
      await request('/api/v1/me', {
        method: 'PATCH',
        token: tokens.get(person.role),
        body: {
          districtId: person.role === 'host' ? besiktas : kadikoy,
          position: person.position,
          level: person.level,
        },
      });
    }
  }

  const team = await request('/api/v1/teams', {
    method: 'POST',
    token: tokens.get('captain'),
    body: { name: '[ÖRNEK] Moda Kartalları', districtId: kadikoy },
  });
  const invite = await request(`/api/v1/teams/${team.id}/invites`, {
    method: 'POST',
    token: tokens.get('captain'),
    body: {},
  });
  for (const role of ['p1', 'p2', 'p3', 'p4', 'p5']) {
    await request(`/api/v1/invites/${invite.code}/accept`, {
      method: 'POST',
      token: tokens.get(role),
      body: {},
    });
  }

  const venues = await request('/api/v1/venues?q=kadikoy&limit=20');
  const venue = venues.items.find((item) => item.slug === SAMPLE_VENUE_SLUG);
  if (venue === undefined) {
    throw new Error('sample venue missing; run `pnpm --filter @kadro/db db:seed` first');
  }
  const startsAt = (days, hour) => {
    const date = new Date(Date.now() + days * DAY_MS);
    date.setUTCHours(hour, 0, 0, 0);
    return date.toISOString();
  };
  const match = await request(`/api/v1/teams/${team.id}/matches`, {
    method: 'POST',
    token: tokens.get('captain'),
    body: {
      venueId: venue.id,
      startsAt: startsAt(3, 18),
      format: '7v7',
      feeTotalMinor: 140000,
      slots: 14,
      status: 'open',
    },
  });
  await request(`/api/v1/teams/${team.id}/matches`, {
    method: 'POST',
    token: tokens.get('captain'),
    body: {
      venueText: '[ÖRNEK] Fenerbahçe Parkı Sahası',
      startsAt: startsAt(10, 17),
      format: '6v6',
      feeTotalMinor: 0,
      slots: 12,
      status: 'open',
    },
  });
  const answers = { captain: 'in', p1: 'in', p2: 'in', p3: 'maybe', p4: 'in', p5: 'out' };
  for (const [role, status] of Object.entries(answers)) {
    await request(`/api/v1/matches/${match.id}/rsvp`, {
      method: 'PUT',
      token: tokens.get(role),
      body: { status },
    });
  }

  const hostTeam = await request('/api/v1/teams', {
    method: 'POST',
    token: tokens.get('host'),
    body: { name: '[ÖRNEK] Beşiktaş Salı Ligi', districtId: besiktas },
  });
  const hostMatch = await request(`/api/v1/teams/${hostTeam.id}/matches`, {
    method: 'POST',
    token: tokens.get('host'),
    body: {
      venueText: '[ÖRNEK] Abbasağa Halı Saha',
      startsAt: startsAt(4, 17),
      format: '7v7',
      feeTotalMinor: 0,
      slots: 14,
      status: 'open',
    },
  });
  await request(`/api/v1/matches/${hostMatch.id}/open-call`, {
    method: 'POST',
    token: tokens.get('host'),
    body: {
      missingCount: 2,
      position: 'GK',
      level: 'regular',
      expiresAt: new Date(Date.now() + 3 * DAY_MS).toISOString(),
    },
  });

  const values = {
    SHOTS_CAPTAIN: email('captain'),
    SHOTS_EMPTY: email('empty'),
    SHOTS_PASSWORD: password,
    SHOTS_TEAM_ID: team.id,
    SHOTS_MATCH_ID: match.id,
    SHOTS_VENUE_ID: venue.id,
  };
  process.stdout.write(
    `${Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(
    `screenshot seed failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
