# ADR-0025: Weekly GeoJSON export, sitemap data and the licence text

- Status: Accepted
- Deciders: Project owner (decision delegated to the lead); licence pending legal approval
- Phase: 2, package 2D

## Context

Section 3 story 9 asks for a weekly public export per city (GeoJSON) at `/veri` and
`GET export/{city}/latest.geojson`; section 7 asks the API export job for the sitemap input with
honest `lastmod`. ADR-0003 proposes CC BY 4.0 but grants no licence until legal approval.

## Decision

- `export_city` (`app/workers/export.py`) builds a `FeatureCollection` from the same dataset as
  the pack: LineString features for published lines and Point features for active stops, with
  the foreign members `licence` = "CC BY 4.0 proposed; legal approval pending; no licence granted
  yet.", `attribution` = "İnecek Var katkıcıları", `city`, `exported_at` and `version`. It writes
  `exports/<city>/<version>.geojson` to the exports bucket and inserts the `exports` row
  (version = previous + 1). The arq cron runs every Monday at 03:00 Europe/Istanbul.
- `GET export/{city}/latest.geojson` streams the newest export (`application/geo+json`, at most
  50 MiB), 404 when none exists. `GET cities/{slug}/sitemap` returns the line and stop slugs with
  `lastmod` = the publication time of the current version (stops: the newest current version
  containing them, else the stop's update time).

## Consequences

- The export never claims a granted licence; when ADR-0003 is approved, the `licence` member and
  `/veri` change together.
- The export doubles as a community-visible data backup (section 6.20) once it is public.

## Evidence

| # | Check | Command or test | Result |
| - | ----- | --------------- | ------ |
| 1 | Sample city export (tests) | `tests/export/test_export.py::test_export_sample_city_geojson` (3 line and 20 stop features, licence and attribution, object in MinIO, versions 1 and 2) | passed |
| 2 | Public delivery | `test_latest_geojson_served_publicly`, `test_latest_geojson_404_without_export`, `test_public_export_probes_have_no_trace_data`, public scanner | passed |
| 3 | Sitemap input | `test_sitemap_lastmod` | passed |
| 4 | Phase 2 gate: export of the seeded sample city on the compose stack | compose project `inecekvar-p2` (PostGIS 57632, Redis 57633, MinIO 57634), `uv run alembic upgrade head`, `uv run python -m app.seed` (`created=41`), then `export_city(..., "ornek-test-sehri")` | `exports/ornek-test-sehri/1.geojson`, version 1, 5836 bytes, FeatureCollection with 3 LineString and 20 Point features, licence and attribution members present, none of the keys trace, points, author_id, published_by, source_edit_id, email |
| 5 | Schedule | `tests/workers/test_main.py::test_schedule`, `test_jobs_run_against_real_services` | passed |

Not exercised:

- `not exercised: /veri page and Dataset JSON-LD` (web, phase 4).
- `not exercised: export bucket on R2 and its versioning` (no account).
