import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Seeds the data the Maestro flows need into a running local stack (docker compose `web`,
 * `worker` and `postgres`, see e2e/README.md) and writes the values the flows read to
 * `e2e/.env.e2e` (ignored by git).
 *
 * Everything goes through the public API with a mobile client header, except two statements that
 * have no API: marking the seeded accounts' email addresses as verified (the API only verifies
 * through the emailed link) and reading the id of one district (there is no district list route
 * yet). Both run through `psql` inside the compose `postgres` container, are limited to the
 * accounts created by this run, and never delete anything.
 *
 * Each run creates fresh accounts (the run id is part of every email address), so runs never
 * depend on what an earlier run left behind. The password is random per run and lives only in
 * `.env.e2e`; it is a test credential of a local stack, never a real one.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const KADRO_ROOT = resolve(HERE, '..', '..', '..');
export const ENV_FILE = join(HERE, '.env.e2e');

const DAY_MS = 86_400_000;
const SEED_PROVINCE = 'istanbul';
const SEED_DISTRICT = 'kadikoy';
export const SEED_VENUE_SLUG = 'ornek-kadikoy-hali-saha-a';
const SAFE_EMAIL = /^[a-z0-9][a-z0-9.+-]*@example\.com$/u;
const SAFE_IDENTIFIER = /^[A-Za-z0-9_]+$/u;

/** Short lower-case run id: part of every email address and team name of the run. */
export function newRunId(bytes = randomBytes(4)) {
  return bytes.toString('hex');
}

/**
 * Random password that meets the registration rules (length, mixed classes) and is never on a
 * breach list. Made at run time; nothing credential-like is committed.
 */
export function newPassword(bytes = randomBytes(15)) {
  return `Kd-${bytes.toString('base64url')}-9a`;
}

/**
 * Accounts seeded through the API. A free account may own one team (`ownedTeamLimit`), so every
 * team has its own owner: `captain` (team with an open match), `host` (team with an open call),
 * `inviter` (team with an invite); `founder` owns nothing and creates a team in a flow.
 */
export const SEEDED_ROLES = ['captain', 'founder', 'player', 'host', 'inviter', 'deleter'];

export function accountEmails(runId) {
  const make = (role) => `e2e-${role}-${runId}@example.com`;
  return Object.fromEntries([...SEEDED_ROLES, 'signup'].map((role) => [role, make(role)]));
}

/** Rejects anything but the addresses of accountEmails() before they are placed into SQL text. */
export function assertSafeEmail(email) {
  if (!SAFE_EMAIL.test(email)) {
    throw new Error(`refusing to use an unexpected email address in SQL: ${email}`);
  }
  return email;
}

/** `GG.AA.YYYY` and `SS:DD` in the device time zone, the input format of the match form. */
export function matchFormDate(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return {
    date: `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${String(date.getFullYear())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  };
}

/** Keys written to `.env.e2e`; the flows may read exactly these (checked by a unit test). */
export const E2E_ENV_KEYS = [
  'E2E_RUN_ID',
  'E2E_PASSWORD',
  'E2E_CAPTAIN_EMAIL',
  'E2E_FOUNDER_EMAIL',
  'E2E_PLAYER_EMAIL',
  'E2E_DELETER_EMAIL',
  'E2E_SIGNUP_EMAIL',
  'E2E_CAPTAIN_TEAM_ID',
  'E2E_INVITE_TEAM_ID',
  'E2E_RSVP_MATCH_ID',
  'E2E_INVITE_CODE',
  'E2E_OPEN_CALL_ID',
  'E2E_VENUE_ID',
  'E2E_VENUE_SLUG',
  'E2E_MATCH_DATE',
  'E2E_MATCH_TIME',
];

/** `KEY=value` lines; values come from this script and never contain line breaks. */
export function formatEnvFile(values) {
  return `${Object.entries(values)
    .map(([key, value]) => {
      if (!/^[A-Z][A-Z0-9_]*$/u.test(key) || /[\r\n]/u.test(String(value))) {
        throw new Error(`invalid env entry ${key}`);
      }
      return `${key}=${String(value)}`;
    })
    .join('\n')}\n`;
}

function createApi(baseUrl) {
  async function request(path, { method = 'GET', token, body, expect = [200, 201] } = {}) {
    const headers = {
      accept: 'application/json, application/problem+json',
      'x-kadro-client': 'mobile',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    };
    const response = await fetch(new URL(path, baseUrl), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'error',
    });
    const text = await response.text();
    const parsed = text === '' ? null : JSON.parse(text);
    if (!expect.includes(response.status)) {
      const code = parsed !== null && typeof parsed === 'object' ? parsed.code : undefined;
      throw new Error(`${method} ${path} answered ${String(response.status)} (${String(code)})`);
    }
    return parsed;
  }
  return { request };
}

async function waitForHealth(api, attempts = 60) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await api.request('/api/v1/health');
      return;
    } catch (error) {
      if (attempt === attempts) {
        throw error;
      }
      await new Promise((done) => setTimeout(done, 2000));
    }
  }
}

/**
 * `docker` arguments that reach `psql` in the database container: the compose `postgres` service
 * by default, or a named container (`KADRO_E2E_DB_CONTAINER`) for a database started otherwise.
 */
export function psqlTarget(container) {
  if (container === undefined || container === '') {
    return ['compose', 'exec', '-T', 'postgres'];
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/u.test(container)) {
    throw new Error('KADRO_E2E_DB_CONTAINER must be a container name');
  }
  return ['exec', container];
}

function psql(sqlText, { user, database, container }) {
  return execFileSync(
    'docker',
    [
      ...psqlTarget(container),
      'psql',
      '-X',
      '-q',
      '-A',
      '-t',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      user,
      '-d',
      database,
      '-c',
      sqlText,
    ],
    { cwd: KADRO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  ).trim();
}

async function main() {
  // eslint-disable-next-line no-restricted-properties -- test tooling, not application configuration
  const env = process.env;
  const apiUrl = env.KADRO_E2E_API_URL ?? 'http://localhost:3000';
  const db = {
    user: env.POSTGRES_USER ?? 'kadro',
    database: env.POSTGRES_DB ?? 'kadro',
    container: env.KADRO_E2E_DB_CONTAINER,
  };
  if (!SAFE_IDENTIFIER.test(db.user) || !SAFE_IDENTIFIER.test(db.database)) {
    throw new Error('POSTGRES_USER and POSTGRES_DB must be plain identifiers');
  }
  const api = createApi(apiUrl);
  await waitForHealth(api);

  const runId = newRunId();
  const password = newPassword();
  const emails = accountEmails(runId);
  const seeded = Object.entries(emails).filter(([role]) => SEEDED_ROLES.includes(role));

  for (const [role, email] of seeded) {
    await api.request('/api/v1/auth/register', {
      method: 'POST',
      body: { email, password, displayName: `E2E ${role} ${runId}` },
      expect: [202],
    });
  }

  const list = seeded.map(([, email]) => `'${assertSafeEmail(email)}'`).join(', ');
  psql(
    `UPDATE users SET email_verified_at = now() WHERE lower(email) IN (${list}) AND email_verified_at IS NULL`,
    db,
  );
  const districtId = psql(
    `SELECT id FROM districts WHERE il_slug = '${SEED_PROVINCE}' AND slug = '${SEED_DISTRICT}'`,
    db,
  );
  if (!/^[0-9a-f-]{36}$/u.test(districtId)) {
    throw new Error('seed district not found; run `pnpm --filter @kadro/db db:seed` first');
  }

  const tokens = new Map();
  for (const [role, email] of seeded) {
    const session = await api.request('/api/v1/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    tokens.set(role, session.tokens.accessToken);
    await api.request('/api/v1/me', {
      method: 'PATCH',
      token: tokens.get(role),
      body: { districtId },
    });
  }

  const now = Date.now();
  const startsAt = new Date(now + 7 * DAY_MS);
  startsAt.setMinutes(0, 0, 0);
  const createdMatch = async (role, teamId) =>
    api.request(`/api/v1/teams/${teamId}/matches`, {
      method: 'POST',
      token: tokens.get(role),
      body: {
        venueText: 'E2E Saha',
        startsAt: startsAt.toISOString(),
        format: '7v7',
        feeTotalMinor: 0,
        slots: 14,
        status: 'open',
      },
    });
  const createdTeam = async (role, name) =>
    api.request('/api/v1/teams', {
      method: 'POST',
      token: tokens.get(role),
      body: { name: `${name} ${runId}`, districtId },
    });

  // Inviter: the team whose invite link the player opens. Host: the team whose open call the
  // player applies to (a different team, so joining never makes the player a member there).
  const inviteTeam = await createdTeam('inviter', 'E2E Davet');
  const invite = await api.request(`/api/v1/teams/${inviteTeam.id}/invites`, {
    method: 'POST',
    token: tokens.get('inviter'),
    body: {},
  });
  const callTeam = await createdTeam('host', 'E2E Ilan');
  const callMatch = await createdMatch('host', callTeam.id);
  const call = await api.request(`/api/v1/matches/${callMatch.id}/open-call`, {
    method: 'POST',
    token: tokens.get('host'),
    body: {
      missingCount: 2,
      position: null,
      level: 'casual',
      expiresAt: new Date(now + 6 * DAY_MS).toISOString(),
    },
  });

  // Captain: a team with an open match for the RSVP flow and the match creation flow.
  const captainTeam = await createdTeam('captain', 'E2E Kaptan');
  const captainMatch = await createdMatch('captain', captainTeam.id);

  const venues = await api.request(`/api/v1/venues?q=${SEED_DISTRICT}&limit=20`);
  const venue = venues.items.find((item) => item.slug === SEED_VENUE_SLUG);
  if (venue === undefined) {
    throw new Error('sample venue not found; run `pnpm --filter @kadro/db db:seed` first');
  }

  const formDate = matchFormDate(new Date(now + 8 * DAY_MS));
  const values = {
    E2E_RUN_ID: runId,
    E2E_PASSWORD: password,
    E2E_CAPTAIN_EMAIL: emails.captain,
    E2E_FOUNDER_EMAIL: emails.founder,
    E2E_PLAYER_EMAIL: emails.player,
    E2E_DELETER_EMAIL: emails.deleter,
    E2E_SIGNUP_EMAIL: emails.signup,
    E2E_CAPTAIN_TEAM_ID: captainTeam.id,
    E2E_INVITE_TEAM_ID: inviteTeam.id,
    E2E_RSVP_MATCH_ID: captainMatch.id,
    E2E_INVITE_CODE: invite.code,
    E2E_OPEN_CALL_ID: call.id,
    E2E_VENUE_ID: venue.id,
    E2E_VENUE_SLUG: venue.slug,
    E2E_MATCH_DATE: formDate.date,
    E2E_MATCH_TIME: '20:00',
  };
  if (Object.keys(values).join() !== E2E_ENV_KEYS.join()) {
    throw new Error('seeded values and E2E_ENV_KEYS differ');
  }
  writeFileSync(ENV_FILE, formatEnvFile(values), { mode: 0o600 });
  process.stdout.write(
    `seeded run ${runId}: accounts, teams, invite, open call; values written to e2e/.env.e2e\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(
      `e2e seed failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  });
}
