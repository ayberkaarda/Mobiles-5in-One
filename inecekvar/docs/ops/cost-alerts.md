# Cost alerts

Spec section 6 item 22. This page lists every running cost of an İnecek Var deployment, the
threshold at which someone must act, what the application does by itself and what the owner must
configure at each provider. Decisions and evidence: [ADR-0054](../adr/0054-cost-guards-and-degrade-mode.md);
hosting plan: [ADR-0002](../adr/0002-hosting-and-backups.md).

Evidence limit ([ADR-0005](../adr/0005-portfolio-delivery-scope.md)): there is no hosting, no
Cloudflare R2, no Resend, no RevenueCat and no Sentry account. The application caps and the
`cost.guard` job are exercised by tests against PostgreSQL and fake Redis; every provider alert
below is a setting the owner makes in a console that does not exist yet and is
`not exercised: no provider account`. Prices and free tiers are taken from the providers' public
pages and must be checked again when the accounts are opened.

## Who is told and how

| Channel | What arrives | Source |
| --- | --- | --- |
| API and worker log (JSON on stdout) | `cost.guard.alert` at error level (resource, count, threshold, UTC day), `cost.guard.degrade_on` / `cost.guard.degrade_off`, `cost.guard.source_error`, `ops.planner_degrade` | `app/workers/cost_guard.py`, `app/ops/planner_degrade.py` |
| Log-based alert | a rule on the log collector that pages the owner on `level=error` and `event` starting with `cost.guard.` or `backup.verify.` | owner configures it with the host; not exercised |
| Provider budget mail | the account email of each console | owner configures it, see the provider table |
| Monthly review | the owner, first working day of the month, with this page as checklist | manual |

There is no alert mailer in the application: a mail sent by the guard would itself spend the
mail quota it watches. The log line is the alert; turning it into a page or a mail is the job of
the log collector of the host (ADR-0002 picks the host; none exists).

## Application caps (automated, in the code)

| Resource | Cap | Where | Evidence |
| --- | --- | --- | --- |
| Planner requests | 30 per client IP per minute (`plan` rule) | `app/core/settings.py` `RATE_LIMIT_RULES` | `tests/planner/test_api.py::test_plan_rate_limited_31st_request` |
| Planner CPU per request | 3 s search, then 1 s with at most 1 transfer, `degraded=true` on timeout | `app/planner/service.py` | `test_plan_timeout_returns_degraded_not_500` |
| Planner graph size | 20,000 active stops per city, beyond that `degraded=true` with no result | `MAX_PLANNER_STOPS` | `test_plan_city_beyond_capacity_degrades` |
| Planner degrade mode | forced by the flag: at most 1 transfer, 1 s budget, `degraded=true`, cache 30 min | `app/planner/degrade.py` | `tests/planner/test_degrade.py` |
| Pack downloads | 10 per anonymous network hash or signed-in user per day (`pack.download`) | `app/export/router.py` | `tests/export/test_packs.py::test_pack_download_rate_limit_per_anon_hash` |
| Photo presigns | 20 per user per day (`media.presign`), 4 MiB per photo | `app/media/router.py` | `tests/media/test_media.py::test_presign_quota_20_per_day` |
| Admin exports | 10 per admin per hour (`admin.export`) | `app/admin/router.py` | rate-limit rule table |
| Sign-in mail | 5 per IP and 5 per address per 15 minutes; 3 per day to an address that bounced | auth rules | `tests/auth/test_rate_limit_real_redis.py::test_sixth_login_is_429_on_real_redis` |

## Daily guard (`cost.guard`, automated)

The worker runs `cost_guard_job` every 15 minutes (minutes 7, 22, 37 and 52, Europe/Istanbul
worker clock; the counted day is the UTC day). Thresholds come from `INECEKVAR_COST_GUARD_*`
(table in [env.md](env.md)); a count **at or above** the threshold alerts once per resource and
day.

| Resource | Counted from | Default threshold | Why this number | What happens |
| --- | --- | --- | --- | --- |
| `emails` | `magic_links` created today plus `deletion_requests` completed today | 80 | 80 % of the 100 mails a day of the Resend free tier (3,000 a month) | one `cost.guard.alert`; the owner checks for a sign-in flood (the per-IP and per-address limits hold each sender; many senders mean abuse or growth) and raises the Resend plan or the threshold |
| `pack_downloads` | `pack_downloads` rows of today | 1,000 | packs are served by the API from the database; 1,000 a day is far above the expected use of one sample city | alert; check `pack_download_stats` per city and the anon hash spread |
| `presigns` | `photos` created today | 300 | 300 x 4 MiB = 1.2 GiB a day; ten such days fill the 10 GB R2 free storage | alert; moderation queue and R2 storage checked; the per-user quota still holds |
| `exports` | `exports` created today | 20 | one weekly run per city plus a few admin runs; more means a loop or an abused admin account | alert; check the `admin.export` audit rows |
| `planner_calls` | Redis hour buckets `inecekvar:cost:planner-calls:<UTC YYYYMMDDHH>` of today | 20,000 | about 14 plans a minute all day long; the single-host planner is CPU bound | alert only |
| planner load | the busier of the current and the previous UTC hour | 3,000 per hour | about 50 plans a minute for an hour: the point where one host's CPU is the risk | **sets the planner degrade flag** (below) |

What is counted is what the application did, not what the provider billed: a mail rejected by
Resend still counts, a mail sent by a provider retry does not. The counters are a tripwire, not
an invoice.

Repeat suppression: the first alert of a resource and day writes `inecekvar:cost:alerted:<day>:<resource>`
(48 h expiry); later runs that day count the resource as a repeat and log nothing at error level.
If Redis cannot be written the alert is logged again on the next run: a repeated alert is
preferred to a lost one. A database or Redis failure logs `cost.guard.source_error` with the
error class only and the run evaluates whatever it could read; the job never raises.

Dry run: `INECEKVAR_COST_GUARD_DRY_RUN=true`, `INECEKVAR_JOBS_DRY_RUN=true` or
`enqueue_job("cost_guard_job", dry_run=True)` logs `cost.guard.alert_suppressed` and
`cost.guard.degrade_suppressed` and writes no marker and no flag.

## Planner degrade mode

Spec item 22 asks for degrade mode "when the CPU alert fires". A CPU alert is a host metric and
there is no host (below). The application therefore uses the nearest signal it owns, the planner
request rate, and gives the operator a switch for a real CPU alert:

- **Automatic:** when the hourly planner load reaches `INECEKVAR_COST_GUARD_PLANNER_CALLS_PER_HOUR`,
  the guard writes `inecekvar:ops:planner-degrade` (source `cost_guard`, reason `planner_load`) for
  `INECEKVAR_COST_GUARD_COOL_DOWN_MINUTES` (default 60) and re-arms it on every run while the load
  holds. After the load drops and a full cool-down has passed since the last re-arm, the guard
  deletes its flag (`cost.guard.degrade_off`). `INECEKVAR_COST_GUARD_DEGRADE_ON_LOAD=false` turns
  the automatic switch off and keeps the alert.
- **By hand:** `uv run python -m app.ops.planner_degrade on --minutes 60 --reason cpu_alert --operator <slug>`,
  `... off`, `... status`. Each switch writes one `ops.planner_degrade` audit line (action,
  previous state, source, reason, lifetime, operator label). The guard never overwrites or
  clears an operator flag; it expires or is switched off.
- **Effect:** while the flag is active every `POST /v1/plan` searches with at most one transfer
  and a 1 s budget, answers `degraded: true` (the existing contract field) and caches the answer
  for 30 minutes under its own key (`plan:v1:...:<transfers>:degraded`). The mobile planner shows
  `planner.degradedNote` above the cards ("Planlayıcı yoğun: sonuçlar en çok 1 aktarmayla
  sınırlı."), and the empty degraded state when nothing was found
  (`apps/mobile/src/app/pages/plan-favorites.spec.ts` "flags degraded results above the cards").
- **Failure:** an unreadable flag or a Redis error reads as "not degraded"; the 3 s timeout and
  the rate limit still bound the cost.

## Provider budgets and alerts (owner configures; not possible here)

| Cost | Threshold to set | Where | Status |
| --- | --- | --- | --- |
| Hosting (one VPS, ADR-0002) | monthly budget with an alert at 80 % | the host's billing console | not exercised: no host |
| Host CPU | alert at 80 % CPU for 10 minutes; on alert run `planner_degrade on` (or hook the alert to that command) | the host's monitoring | not exercised: no host; the application cannot read host CPU |
| Host disk, PostgreSQL size | disk above 70 % (act) and 85 % (urgent); database above 5 GB | host monitoring, `SELECT pg_database_size(...)` weekly | not exercised |
| Redis memory | above 75 % of `maxmemory`; planner cache and rate-limit keys all carry expiries | host monitoring, `INFO memory` | not exercised |
| R2 storage | 8 GB (80 % of the 10 GB free tier) across media, exports and backups | Cloudflare dashboard, R2 usage notification | not exercised: no account |
| R2 operations | 800,000 Class A or 8,000,000 Class B a month (80 % of free tier) | Cloudflare dashboard | not exercised |
| PMTiles egress | R2 egress is free; put the tiles behind a Cloudflare cache rule (`*.pmtiles` at the root of the tiles host: the API redirects to `INECEKVAR_PMTILES_BASE_URL + "/" + slug + ".pmtiles"` in `api/app/export/router.py` and the app reads `<tilesBase>/<slug>.pmtiles` in `map.component.ts` `basemapUrlFor`; cache everything, edge TTL 1 day, respect range requests) so reads hit the cache, not the bucket's Class B budget | Cloudflare cache rules | not exercised: `INECEKVAR_PMTILES_BASE_URL` is unset, tiles answer 404 |
| Resend volume | 80 mails a day, 2,400 a month (80 % of free tier); the guard's `emails` alert is the in-app half | Resend dashboard usage alert | not exercised |
| RevenueCat tier | monthly tracked revenue near the free tier limit | RevenueCat dashboard | not exercised |
| Sentry quota | error and transaction quota with spike protection on; only scrubbed events (docs/ops/logging.md) | Sentry project settings | not exercised: no SDK, no DSN |

## Monthly review checklist

1. Read the month's `cost.guard.alert`, `cost.guard.degrade_on` and `ops.planner_degrade` lines.
2. Compare each provider console with the table above; raise a threshold here and in the
   environment together, never in one place only.
3. Confirm the provider budget mails still reach the owner's address.
