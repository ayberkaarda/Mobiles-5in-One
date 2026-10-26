#!/usr/bin/env node
/**
 * Repeatable OWASP ZAP run against a LOCAL production build with a REAL database.
 *
 *   pnpm install --frozen-lockfile                                    # once, from kadro/
 *   pnpm turbo run build --filter=@kadro/web --filter=@kadro/worker   # also builds packages/db
 *   node ops/zap-scan.mjs [baseline] [baseline-venue] [baseline-district] [api] [api-auth]   # default: all
 *
 * Safety: everything it creates is local and uniquely named (`kadro-zap-*`).
 *  - a disposable PostGIS container (tmpfs data, loopback port), removed by exact name;
 *  - `next start` on a free port with a dummy run-time configuration (no real secret);
 *  - one ZAP container per scan, removed by exact name.
 * It never runs prune / `down -v` and never writes a credential into the repository: the signing
 * keys, passwords and the bearer token are created at run time and only live in this process.
 * Reports go to a temporary directory (printed at the end), not into the repository.
 *
 * After each phase it prints the ZAP summary line, the alerts of the JSON report and, from the
 * server's own per-request log (route, status, client type, problem code), the status mix the
 * scanner produced. An API phase whose requests never got past the client-header check, or (for
 * `api-auth`) past authentication, tested nothing: the run then exits non-zero instead of passing.
 *
 * The API scan is an ACTIVE scan: point it only at the disposable server this script starts.
 */
import { execFile, spawn } from 'node:child_process';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import {
  createWriteStream,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { EOL, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const WEB = join(ROOT, 'apps', 'web');
const DB_PKG = join(ROOT, 'packages', 'db');
const SPEC = join(ROOT, 'docs', 'api', 'openapi.json');
const ZAP_IMAGE = 'ghcr.io/zaproxy/zaproxy:stable';
const PG_IMAGE = 'postgis/postgis:16-3.5-alpine';
const CRED = 'kadro_zap';
const epoch = Math.floor(Date.now() / 1000);
const outDir = join(tmpdir(), `kadro-zap-${epoch}`);
const SEEDED = {
  'baseline-venue': '/saha/ornek-kadikoy-hali-saha-a',
  'baseline-district': '/eksik-var/istanbul/kadikoy',
};
const phases =
  process.argv.slice(2).length > 0
    ? process.argv.slice(2)
    : ['baseline', 'baseline-venue', 'baseline-district', 'api', 'api-auth'];

const created = [];
let server;

const docker = async (args) => (await run('docker', args, { windowsHide: true })).stdout.trim();

async function freePort() {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.once('error', fail);
    s.listen(0, '0.0.0.0', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });
}

/** HTTP call to the local server with the Host header the app expects (its configured origin). */
function call(port, method, path, headers = {}, body) {
  return new Promise((ok, fail) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers: { host: `host.docker.internal:${port}`, ...headers },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          ok({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }),
        );
      },
    );
    req.on('error', fail);
    req.end(body);
  });
}

async function cleanup() {
  server?.kill();
  for (const name of created) {
    // exact container name only
    await docker(['rm', '--force', name]).catch(() => undefined);
  }
}

async function loadPg() {
  const { default: pg } = await import(
    new URL(
      `file:///${join(DB_PKG, 'node_modules', 'pg', 'lib', 'index.js').replaceAll('\\', '/')}`,
    )
  );
  return pg;
}

/** One query on a short-lived connection (the disposable database only). */
async function query(url, sql) {
  const pg = await loadPg();
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 2000 });
  try {
    await client.connect();
    return (await client.query(sql)).rows;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function waitDb(url) {
  let ok = 0;
  for (let i = 0; i < 180 && ok < 2; i += 1) {
    try {
      await query(url, 'select 1');
      ok += 1;
    } catch {
      ok = 0;
    }
    await delay(500);
  }
  if (ok < 2) throw new Error('database not ready');
}

function webEnv(port, databaseUrl) {
  const keys = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const origin = `http://host.docker.internal:${port}`;
  return {
    PATH: process.env.PATH ?? '',
    SystemRoot: process.env.SystemRoot ?? '',
    NODE_ENV: 'production',
    APP_ENV: 'local',
    BUILD_SHA: 'zap-local',
    LOG_LEVEL: 'info',
    DATABASE_URL: databaseUrl,
    WEB_ORIGIN: origin,
    CORS_ALLOWED_ORIGINS: origin,
    JWT_PRIVATE_KEY: keys.privateKey,
    JWT_PUBLIC_KEY: keys.publicKey,
    CSRF_SECRET: randomBytes(32).toString('base64url'),
    HASH_SECRET: randomBytes(32).toString('base64url'),
    // The longest allowed access-token lifetime, so an authenticated scan that runs longer than the
    // 15-minute default does not silently turn into anonymous 401s halfway through.
    ACCESS_TOKEN_TTL_SECONDS: '3600',
    APPLE_AUDIENCES: 'app.kadro.mobile',
    GOOGLE_CLIENT_IDS: '100000000000-kadrozap.apps.googleusercontent.com',
    CLIENT_IP_HEADER: 'x-forwarded-for',
    TRUSTED_PROXY_CIDRS: '10.0.0.5/32',
    EMAIL_TRANSPORT: 'log',
    PUSH_TRANSPORT: 'log',
  };
}

async function zap(label, script, args) {
  const name = `kadro-zap-${label}-${epoch}`;
  created.push(name);
  mkdirSync(outDir, { recursive: true });
  const base = [
    'run',
    '--name',
    name,
    '-v',
    `${outDir}:/zap/wrk:rw`,
    '-v',
    `${SPEC}:/zap/spec/openapi.json:ro`,
  ];
  const child = spawn('docker', [...base, ZAP_IMAGE, script, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const log = createWriteStream(join(outDir, `zap-${label}.log`));
  let text = '';
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk) => {
      process.stdout.write(chunk);
      log.write(chunk);
      text += chunk.toString('utf8');
    });
  }
  const exit = await new Promise((ok) => child.on('exit', ok));
  log.end();
  await docker(['rm', '--force', name]).catch(() => undefined);
  const summary = /FAIL-NEW: \d+.*PASS: \d+/.exec(text)?.[0] ?? 'no summary line';
  return { exit, summary };
}

/** Risk, alert name, plugin id and instance count from a ZAP traditional JSON report. */
function alerts(file) {
  try {
    const report = JSON.parse(readFileSync(join(outDir, file), 'utf8'));
    return report.site.flatMap((site) =>
      (site.alerts ?? []).map((a) => `${a.riskdesc} | ${a.name} [${a.pluginid}] x${a.count}`),
    );
  } catch (error) {
    return [`report unreadable: ${String(error)}`];
  }
}

const bump = (counts, key) => {
  counts.set(key, (counts.get(key) ?? 0) + 1);
};

/**
 * Status / client / problem-code mix of the API requests the server handled during one phase,
 * read from the server's own structured request log (one JSON line per Route Handler call). This
 * is the evidence that the scanner's headers reached the server: client `mobile` instead of a 400
 * for a missing header and, for `api-auth`, requests that got past authentication.
 */
function serverMix(tag) {
  const status = new Map();
  const client = new Map();
  const problem = new Map();
  const reached = new Set();
  let total = 0;
  for (const line of readFileSync(join(outDir, `server-${tag}.log`), 'utf8').split(/\r?\n/)) {
    if (!line.startsWith('{')) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof entry.route !== 'string' || typeof entry.status !== 'number') continue;
    total += 1;
    bump(status, entry.status);
    bump(client, String(entry.client));
    bump(problem, entry.problemCode ?? '-');
    if (entry.status < 400) reached.add(`${entry.method} ${entry.route}`);
  }
  const sorted = (m) => Object.fromEntries([...m].sort((a, b) => b[1] - a[1]));
  return {
    total,
    status: sorted(status),
    client: sorted(client),
    problem: sorted(problem),
    operationsWith2xx: reached.size,
  };
}

/**
 * An active API scan of the ~70 documented operations sends thousands of requests; far fewer means
 * the scan was cut short (for example by exhausted host ports), not that it passed.
 */
const MIN_API_REQUESTS = 1000;

/** The API phase reached handlers: the client header was accepted and (with a token) auth passed. */
function apiTestedSomething(phase, mix) {
  if (mix.total < MIN_API_REQUESTS) return false;
  const mobile = mix.client.mobile ?? 0;
  const below400 = Object.entries(mix.status)
    .filter(([s]) => Number(s) < 400)
    .reduce((n, [, c]) => n + c, 0);
  if (mix.total === 0 || mobile === 0 || below400 === 0) return false;
  if (phase === 'api-auth') {
    return (mix.status['401'] ?? 0) < mix.total / 4;
  }
  return true;
}

/**
 * ZAP replacer rules as a properties file (a value with a space, such as a bearer header, cannot be
 * passed through the space-split `-z` option). The file lives in the temporary report directory,
 * never in the repository, and is removed with it. Note the key is `matchstr`: a misspelled key
 * silently yields a malformed header line.
 */
function replacerOptions(label, rules) {
  mkdirSync(outDir, { recursive: true });
  const lines = rules.flatMap(([header, value], i) => [
    `replacer.full_list(${i}).description=r${i}`,
    `replacer.full_list(${i}).enabled=true`,
    `replacer.full_list(${i}).matchtype=REQ_HEADER`,
    `replacer.full_list(${i}).matchstr=${header}`,
    `replacer.full_list(${i}).regex=false`,
    `replacer.full_list(${i}).replacement=${value}`,
    `replacer.full_list(${i}).initiators=`,
  ]);
  const file = `replacer-${label}.properties`;
  writeFileSync(join(outDir, file), `${lines.join(EOL)}${EOL}`, { mode: 0o600 });
  return `-configfile /zap/wrk/${file}`;
}

/**
 * Every scanner request is a new TCP connection through Docker's host port proxy. On Windows the
 * closed sockets stay in TIME_WAIT for two minutes, and a full API scan leaves about 15 000 of the
 * 16 384 dynamic ports in that state: the next phase then fails to connect even to its own database
 * (`connect EADDRINUSE`) and ZAP's active scan stops early. Wait until the ports have drained.
 */
async function waitForFreePorts() {
  if (process.platform !== 'win32') return;
  for (let i = 0; i < 60; i += 1) {
    const { stdout } = await run('netstat', ['-an'], { windowsHide: true, maxBuffer: 64 << 20 });
    const waiting = stdout.split('\n').filter((l) => l.includes('TIME_WAIT')).length;
    if (waiting < 2000) return;
    if (i === 0) console.log(`waiting for ${waiting} TIME_WAIT sockets to drain`);
    await delay(5_000);
  }
  throw new Error('host ports did not drain within 5 minutes');
}

process.on('SIGINT', () => void cleanup().then(() => process.exit(130)));

/**
 * One fresh database + server per scan, so the rate-limit buckets (kept in the database) of an earlier
 * scan cannot turn the next scan's requests into 429s.
 */
async function startStack(tag) {
  const dbName = `kadro-zap-db-${tag}-${epoch}`;
  created.push(dbName);
  await docker([
    'run',
    '--detach',
    '--name',
    dbName,
    '--label',
    'kadro.purpose=zap-scan',
    '--tmpfs',
    '/var/lib/postgresql/data',
    '--env',
    `POSTGRES_USER=${CRED}`,
    '--env',
    `POSTGRES_PASSWORD=${CRED}`,
    '--env',
    `POSTGRES_DB=${CRED}`,
    '--publish',
    '127.0.0.1::5432',
    PG_IMAGE,
  ]);
  const mapping = await docker(['port', dbName, '5432/tcp']);
  const dbPort = /:(\d+)\s*$/m.exec(mapping)?.[1];
  const databaseUrl = `postgres://${CRED}:${CRED}@127.0.0.1:${dbPort}/${CRED}`;
  await waitDb(databaseUrl);

  const port = await freePort();
  const env = webEnv(port, databaseUrl);
  const cli = (name) =>
    run(process.execPath, [join(DB_PKG, 'dist', 'cli', `${name}.js`)], { env, cwd: DB_PKG });
  console.log((await cli('migrate')).stdout.trim());
  console.log((await cli('seed')).stdout.trim());

  // The worker creates the pg-boss queues (migration 0010 only creates the schema; the web process
  // only sends). Start it just until its queues exist so enqueueing routes (register,
  // forgot-password, ...) do not 500 for an environment reason; it is stopped before any scan.
  const worker = spawn(process.execPath, [join(ROOT, 'apps', 'worker', 'dist', 'main.js')], {
    cwd: join(ROOT, 'apps', 'worker'),
    env: {
      ...env,
      R2_ENDPOINT: 'http://localhost:9000',
      R2_ACCESS_KEY_ID: 'kadro-local',
      R2_SECRET_ACCESS_KEY: 'kadro-local-storage',
      R2_INCOMING_BUCKET: 'kadro-uploads-incoming',
      R2_MEDIA_BUCKET: 'kadro-media',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
    windowsHide: true,
  });
  let queues = 0;
  for (let i = 0; i < 120; i += 1) {
    await delay(500);
    const rows = await query(databaseUrl, 'select count(*)::int as n from pgboss.queue').catch(
      () => [{ n: 0 }],
    );
    const n = rows[0]?.n ?? 0;
    // a stable non-zero count over two polls: the worker finished creating its queues
    if (n > 0 && n === queues) break;
    queues = n;
  }
  worker.kill();
  await delay(1_000);
  if (queues === 0) throw new Error('the worker did not create the job queues');
  console.log(`worker: ${queues} job queues present, worker stopped`);

  mkdirSync(outDir, { recursive: true });
  const serverLog = openSync(join(outDir, `server-${tag}.log`), 'w');
  server = spawn(
    process.execPath,
    [
      join(WEB, 'node_modules', 'next', 'dist', 'bin', 'next'),
      'start',
      '--port',
      String(port),
      '-H',
      '0.0.0.0',
    ],
    {
      cwd: WEB,
      env,
      stdio: ['ignore', serverLog, serverLog],
      windowsHide: true,
    },
  );
  let last = 'no answer';
  for (let i = 0; ; i += 1) {
    try {
      const r = await call(port, 'GET', '/api/v1/health');
      if (r.status === 200) break;
      last = `${r.status} ${r.text.slice(0, 200)}`;
    } catch (error) {
      last = String(error);
    }
    if (i === 239) throw new Error(`web server not ready: ${last}`);
    await delay(250);
  }
  return {
    port,
    dbName,
    target: `http://host.docker.internal:${port}`,
    async stop() {
      server?.kill();
      server = undefined;
      await docker(['rm', '--force', dbName]).catch(() => undefined);
    },
  };
}

/** Direct requests (not ZAP) proving which database-backed pages answer 200 on this server. */
async function preflight(port) {
  const sitemap = await call(port, 'GET', '/sitemap.xml');
  const paths = [...sitemap.text.matchAll(/<loc>https?:\/\/[^/<]+([^<]*)<\/loc>/g)].map(
    (m) => m[1],
  );
  console.log(`preflight: /sitemap.xml -> ${sitemap.status}, ${paths.length} URLs`);
  const seen = new Set();
  for (const path of paths) {
    const prefix = `/${path.split('/')[1] ?? ''}`;
    if (seen.has(prefix)) continue;
    seen.add(prefix);
    console.log(`preflight: ${path} -> ${(await call(port, 'GET', path)).status}`);
  }
  const home = await call(port, 'GET', '/');
  const links = new Set([...home.text.matchAll(/href="(\/[^"#?]*)"/g)].map((m) => m[1]));
  console.log(`preflight: / -> ${home.status}, ${links.size} distinct internal links`);
}

async function bearerToken(stack) {
  const email = `zap-${randomBytes(4).toString('hex')}@example.test`;
  const password = randomBytes(18).toString('base64url');
  const headers = { 'content-type': 'application/json', 'x-kadro-client': 'mobile' };
  const reg = await call(
    stack.port,
    'POST',
    '/api/v1/auth/register',
    headers,
    JSON.stringify({ email, password, displayName: 'Zap Tester' }),
  );
  if (reg.status !== 202) throw new Error(`register answered ${reg.status}`);
  await docker([
    'exec',
    stack.dbName,
    'psql',
    '-U',
    CRED,
    '-d',
    CRED,
    '-c',
    `update users set email_verified_at = now() where email = '${email}'`,
  ]);
  const login = await call(
    stack.port,
    'POST',
    '/api/v1/auth/login',
    headers,
    JSON.stringify({ email, password, deviceLabel: 'zap' }),
  );
  const access = JSON.parse(login.text)?.tokens?.accessToken;
  if (login.status !== 200 || typeof access !== 'string')
    throw new Error(`login answered ${login.status}`);
  return access;
}

const apiArgs = (target, name, z) => [
  '-t',
  '/zap/spec/openapi.json',
  '-f',
  'openapi',
  '-O',
  target,
  '-I',
  '-J',
  `${name}.json`,
  '-r',
  `${name}.html`,
  '-z',
  z,
];

let failed = false;
try {
  console.log(`docker ${await docker(['info', '--format', '{{.ServerVersion}}'])}`);
  const results = {};
  for (const phase of phases) {
    await waitForFreePorts();
    const started = Date.now();
    const stack = await startStack(phase);
    try {
      if (phase === 'baseline') {
        await preflight(stack.port);
        results.baseline = await zap('baseline', 'zap-baseline.py', [
          '-t',
          stack.target,
          '-m',
          '2',
          '-I',
          '-J',
          'baseline.json',
          '-r',
          'baseline.html',
        ]);
      } else if (phase in SEEDED) {
        // Sample venues and districts without a live call are noindex and not linked from the public
        // site, so the spider never finds them from the home page: start it on the page itself.
        const path = SEEDED[phase];
        console.log(`preflight: ${path} -> ${(await call(stack.port, 'GET', path)).status}`);
        results[phase] = await zap(phase, 'zap-baseline.py', [
          '-t',
          `${stack.target}${path}`,
          '-m',
          '1',
          '-I',
          '-J',
          `${phase}.json`,
          '-r',
          `${phase}.html`,
        ]);
      } else if (phase === 'api') {
        results.api = await zap(
          'api',
          'zap-api-scan.py',
          apiArgs(stack.target, 'api', replacerOptions('api', [['x-kadro-client', 'mobile']])),
        );
      } else if (phase === 'api-auth') {
        const access = await bearerToken(stack);
        results['api-auth'] = await zap(
          'apiauth',
          'zap-api-scan.py',
          apiArgs(
            stack.target,
            'api-auth',
            replacerOptions('auth', [
              ['x-kadro-client', 'mobile'],
              ['Authorization', `Bearer ${access}`],
            ]),
          ),
        );
      } else {
        throw new Error(`unknown phase ${phase}`);
      }
    } finally {
      await stack.stop();
    }
    const result = results[phase];
    result.minutes = Math.round((Date.now() - started) / 6000) / 10;
    result.alerts = alerts(`${phase}.json`);
    result.server = serverMix(phase);
    if (phase.startsWith('api') && !apiTestedSomething(phase, result.server)) {
      result.testedNothing = true;
      failed = true;
    }
    // any 500 is either a defect or an environment fault; both need a look before calling it a pass
    if (result.exit !== 0 || (result.server.status['500'] ?? 0) > 0) failed = true;
    console.log(`\n== ${phase}: ${JSON.stringify(result, null, 2)}\n`);
  }
  console.log(`
Summary: ${JSON.stringify(
    Object.fromEntries(
      Object.entries(results).map(([k, v]) => [
        k,
        {
          exit: v.exit,
          summary: v.summary,
          minutes: v.minutes,
          requests: v.server.total,
          status500: v.server.status['500'] ?? 0,
          testedNothing: !!v.testedNothing,
        },
      ]),
    ),
  )}
Reports: ${outDir}`);
} finally {
  await cleanup();
  // the option files may hold the run-time bearer token
  for (const f of ['replacer-api.properties', 'replacer-auth.properties'])
    rmSync(join(outDir, f), { force: true });
}
if (failed) process.exitCode = 1;
