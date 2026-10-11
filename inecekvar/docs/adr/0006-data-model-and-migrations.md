# ADR-0006: Data model, migrations and the sample seed

- Status: Accepted
- Deciders: Project owner
- Phase: 1, package 1A

## Context

Section 5 of the specification lists the tables, section 0 forbids invented route data and asks
for a labelled sample city, and section 6 items 4, 6, 11, 12 and 21 put requirements on the
schema (no self-approval, input bounds, hashed secrets, refresh-token families, anonymised
contributions after account deletion). Later Phase 1 packages (auth, policy, API) build on this
schema, so the interfaces must be fixed before they start.

## Decision

Libraries (resolved in `api/uv.lock`): SQLAlchemy 2.1.4 (async), GeoAlchemy2 0.20.0, Alembic
1.20.0, asyncpg 0.32.0, shapely 2.2.0; types-shapely as a dev dependency. Database image
`postgis/postgis:16-3.5`.

Identifiers. `app/core/ids.py` provides `uuid7()` (RFC 9562 version 7: 48-bit Unix millisecond
timestamp, 12-bit counter, 62 random bits from `secrets`), created in Python, thread-safe and
strictly increasing within a process; a clock that goes backwards keeps the stored timestamp and
only the counter advances. `uuid7_timestamp_ms()` reads the timestamp back. Python 3.12 has no
standard UUIDv7, and no dependency was added for it.

Models. `app/models/` holds one declarative `Base` with a constraint naming convention
(`pk_`, `fk_`, `uq_`, `ix_`, `ck_<table>_<name>`), the mixins `UUIDPrimaryKey` (Python-side
`uuid7` default) and `Timestamps` (`created_at`, `updated_at`, `timestamptz`, server default
`now()`), and 20 tables: `cities`, `lines`, `line_versions`, `stops`, `line_stops`, `edits`,
`traces`, `photos`, `users`, `sessions`, `refresh_tokens`, `magic_links`, `favorites`,
`deletion_requests`, `subscriptions`, `pack_downloads`, `webhook_events`, `email_suppressions`,
`audit_logs`, `exports`. The join tables `line_stops` and `favorites` use composite primary keys
and `created_at` only. Enumerations are `StrEnum`s in `app/models/enums.py`, stored as
`varchar(32)` with a named CHECK constraint, not as native PostgreSQL enum types, so a later value
needs only a constraint swap.

Schema rules enforced by the database:

- Geometry in SRID 4326: `cities.bbox` polygon and `cities.centroid` point (centroid inside the
  bbox), `line_versions.geom` linestring (at least 2 points, valid, at most 150 km on the
  spheroid), `stops.location` geography point. Four GiST indexes cover these columns.
- Slugs match `^[a-z0-9]+(-[a-z0-9]+)*$`; `cities.slug` is unique, `lines` and `stops` are
  unique per `(city_id, slug)`.
- Bounds: `fare_minor` 0..10 000 000, trace `points` a JSON array of 2..5 000 entries,
  `ended_at >= started_at`, photo size 1..4 MiB and JPEG or WebP only, counters non-negative,
  token and email hashes exactly 32 bytes, `users.email` lower case, `password_hash` either NULL
  or `$argon2id$...`.
- `edits`: reviewer must differ from author; `reviewed_at` is set exactly when the state is
  approved or rejected; line and stop edit kinds require their target. `withdrawn` is an extra
  state used by the account deletion flow (item 21); it is not in the section 5 list.
- `line_versions` are immutable: the trigger `trg_line_versions_immutable` rejects every DELETE
  and every UPDATE with SQLSTATE 23001, except the single change `published_by -> NULL` that
  `ON DELETE SET NULL` performs when a publishing account is deleted. `line_stops` rows are
  immutable without exception (`trg_line_stops_immutable`). Lines are therefore retired, never
  deleted (`ON DELETE RESTRICT` from versions to lines).
- Account deletion: `edits.author_id`, `edits.reviewer_id`, `line_versions.published_by`,
  `audit_logs.actor_id` and `pack_downloads.user_id` become NULL; traces, photos, sessions,
  refresh tokens, magic links, favorites, subscriptions and deletion requests are deleted with
  the account.
- Refresh tokens carry `family_id` and `parent_id`; revocation has a reason from
  `rotated|reuse_detected|logout|logout_all|account_deleted`, and `revoked_at` and
  `revoked_reason` are set together.
- `edits.photo_id` references `photos` instead of the specification's free `photo_key`; the
  object key lives once, on `photos.key`.
- `webhook_events` stores no payload, only provider, event id and type.

Migrations. `api/alembic/` runs async through asyncpg. The URL comes from
`config.attributes["database_url"]` (tests) or `INECEKVAR_DATABASE_URL`, never from
`alembic.ini`. The first revision `0001` is hand-written: it creates the `postgis` extension,
all tables with the same constraint names as the models, the circular foreign key
`lines.current_version_id` after `line_versions`, the GiST indexes and both trigger functions.
Its downgrade drops everything except the extension. An `include_object` filter ignores
tables and indexes that are not in the model metadata (the PostGIS image adds its own).

Sessions. `app/models/session.py`: `database_url_from_env()`, `create_engine(url)`
(`pool_pre_ping=True`) and `create_session_factory(engine)` (`expire_on_commit=False`). The
FastAPI wiring (settings object, request-scoped session dependency) belongs to the Phase 1
configuration package and is not part of this decision.

Sample seed. `python -m app.seed` (package `app/seed/`) creates `[ÖRNEK] Test Şehri`
(`ornek-test-sehri`, `is_sample = true`) on a synthetic 5 by 4 stop grid over open sea north of
the Turkish coast (lon 34.00..34.10, lat 42.50..42.58), three published lines `ORN-1`
(dolmuş), `ORN-2` (minibüs) and `ORN-3` (servis), each with one version and its `line_stops`.
Every name starts with `[ÖRNEK]`; no user, credential or real place or route is seeded. Rows
are found by natural keys, so a second run creates nothing; existing versions are never
changed. The command refuses to run when `INECEKVAR_ENV=production`.

## Consequences

- Later packages import `Base` and the model classes from `app.models`, ids from
  `app.core.ids.uuid7`, and sessions from `app.models.session`; schema changes are new Alembic
  revisions, never edits to `0001`.
- Correcting a published route means a new `line_versions` row and moving
  `lines.current_version_id`; rollback (Phase 2) moves the pointer back.
- A misconfigured client cannot store a plain password, an upper-case email, a self-approved
  edit, an oversized trace or an out-of-range fare, even if API validation is bypassed.
- Account deletion cannot erase published history; it anonymises it, as item 21 requires.
- Known limits: `audit_logs` is not protected by a trigger (append-only is enforced only by the
  application for now); the trace retention job that reads `delete_after` arrives in Phase 2;
  the 150 km route limit is checked in the database only, the API mirror arrives with the
  validation package.

## Evidence

Commands ran in `inecekvar/api` on Windows 11 with Docker Desktop 29.7.2. The tests ran on
commits `b075e70c` to `fe3f62b9` (code identical to the working tree at the time of the run).
Logs are kept outside the repository in the owner's local job folder
(`jobs/b7093590/tmp/iv`, files `p1a-gate2.log`, `p1a-cli.log`, `p1a-mutation.log`).

| # | Step | Command | Result |
| - | ---- | ------- | ------ |
| 1 | Lint and format | `uv sync --locked`, `uv run ruff check .`, `uv run ruff format --check .` | exit 0; 37 files |
| 2 | Types | `uv run mypy --strict app tests alembic` | no issues in 37 source files |
| 3 | Tests | `INECEKVAR_REQUIRE_DOCKER=1 uv run pytest` | 50 passed (ids 7, metadata 17, migrations 4, constraints 16, seed 3, earlier tests 3) on Testcontainers `postgis/postgis:16-3.5` |
| 4 | Migration round trip | `uv run alembic upgrade head`, `downgrade base`, `upgrade head` against compose project `inecekvar-p1` (PostgreSQL on 127.0.0.1:57582) | each exit 0; `alembic current` prints `0001 (head)` |
| 5 | Seed twice | `uv run python -m app.seed` twice | `created=41 existing=0`, then `created=0 existing=41`; 1 city (`is_sample = t`), 3 lines, 20 stops, 3 versions, 14 line stops |
| 6 | Trigger | `UPDATE line_versions SET fare_minor = 1 WHERE version_no = 1` through `psql` | `ERROR: line_versions is immutable`, exit 1 |
| 7 | Mutation: no trigger | trigger creation in `0001` replaced by `SELECT 1`, `pytest tests/migrations` | 6 failed, 14 passed (`test_version_immutable[update]`, `[delete]`, `test_anonymisation_rejects_other_changes`, `test_null_publisher_noop_rejected`, `test_upgrade_downgrade_upgrade`, `test_immutability_triggers`) |
| 8 | Mutation: fare bound | fare CHECK reduced to `fare_minor >= 0`, `pytest tests/migrations` | 1 failed (`test_fare_boundary`), 19 passed; the file was restored and its SHA-256 checked |
| 9 | Secrets | gitleaks 8.30.1 `git --log-opts="origin/main..HEAD"` | 22 commits scanned (the branch since `origin/main`, code commits included), no leaks found |

Not exercised:

- `not exercised: the seed and migrations in CI` (the branch is not pushed).
- `not exercised: upgrade from a populated earlier schema` (`0001` is the first revision).
