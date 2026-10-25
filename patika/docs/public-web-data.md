# Public web: data access

`Patika.Web` is the public, anonymous, SEO side of Patika. It only reads. This note covers what it
may show, how its database access is locked down, and the district and slug rules its URLs rely on.

## What the public side exposes

The read side lives in `src/Patika.Web/Services/PublicQueries`. Every query returns small records
(`AdoptionCard`, `AdoptionDetail`, `DistrictSummary`, `StationRow`, `CarePlaceView`, `ImpactSummary`,
`SitemapEntry`); no entity leaves that folder.

| Area | Shown |
| --- | --- |
| Adoption posts | Only `Published` posts with `ClosesAt` in the future whose animal is not already adopted: slug, animal name, species, sex, estimated birth year, district, sterilized/vaccinated flags, description, requirements, closing date, approved photos. |
| District pages | District name, active station count, feedings in the last 7 days, open adoption count, a station table (name or "İsimsiz istasyon", kind, species, last-fed bucket: today / this week / older / never), care places, up to 6 adoption cards. |
| Care places | Name, kind, address, phone, HTTPS website, hours, 24h flag, verified flag, district. `IsSample` rows only when `Web:ShowSamples=true` (Development default). |
| Impact | Four completed ISO weeks in Europe/Istanbul: feedings, new stations, adoptions (closed as `Adopted`, counted by `AdoptedAt`), urgent posts created that week and now `Handled`. `ImpactQueries.MethodNote` states this definition on the page. |
| Sitemap | Site-relative paths with lastmod, in chunks of 10,000: public adoption slugs, district pages with an active station or open post, care place slugs. |
| Photos | Only animal photos with `ModerationState.Approved`, always as processed `media/` renditions via `IPhotoUrlResolver`. |

## What it never exposes

- User ids, `CreatedBy`, reviewer ids, emails, display names or any volunteer name. A reflection test
  (`WebSafetyTests.PublicRecordsExposeNoIdentityOrEntities`) fails if a public record gains a `Guid`,
  an entity type or an identity-like property.
- Precise locations: station coordinates are rounded to 3 decimals (about 100 m). Urgent post
  locations, user urgent home areas and animal positions are not part of any public record.
- Station and feeding photos: they are not moderated, so `StationRow` has no photo field at all.
- Hidden urgent posts (`HiddenAt` set), pending/rejected/closed/expired adoption posts, unapproved
  photos, feeding notes and sightings. (The API still shows a hidden urgent post to its owner, flagged
  `Hidden`, and lets the owner or a moderator close it; public GET, nearby and report stay filtered.)

## Database role

The Web app registers `PublicReadContext`: `QueryTrackingBehavior.NoTracking` and both `SaveChanges`
paths throw before anything is sent. That does not stop `ExecuteUpdate`/`ExecuteDelete` or raw SQL, so
production must connect with a SELECT-only role through `ConnectionStrings:PatikaRead`. The
`ConnectionStrings:Patika` fallback is used in Development only; outside Development a missing
`PatikaRead` fails the first query. Never reuse the API or migration credentials.

```sql
CREATE ROLE patika_web LOGIN PASSWORD '<from the secret store>';
GRANT CONNECT ON DATABASE patika TO patika_web;
GRANT USAGE ON SCHEMA public TO patika_web;
GRANT SELECT ON provinces, districts, stations, feedings, animals, animal_photos,
    adoption_posts, care_places, urgent_posts TO patika_web;
-- Nothing else: no INSERT/UPDATE/DELETE, no default privileges, no membership in the API role.
```

Re-run the `GRANT SELECT` when a later migration adds a table the public queries need. Migrations
are applied separately with the migration role, before either app is deployed.

`Storage:PublicBaseUrl` (or the storage endpoint) is the only extra origin allowed in the page CSP
`img-src`.

## Districts

- `provinces` and `districts` are seeded by the `Phase4Data` migration: İstanbul (`istanbul`) and
  its 39 districts with fixed ids (`34000000-0000-0000-0000-0000000000NN`).
- Stations, animals, adoption posts and care places keep their free-text `District` column and gain a
  nullable `DistrictId`. The link is set when `Slug.From(text)` equals a seeded İstanbul district slug
  (`" KADIKÖY! "` and `"Kadıköy"` both become `kadikoy`); anything else stays `null`, never an error.
- The same rule runs in three places: the migration backfill (SQL `pg_temp.patika_slug`),
  `IDistrictResolver`, and the save hook in `PublicDataPreparation` (on insert, and when the
  free-text district changes).

## Slugs

- `Slug.From`: NFC, Turkish folding (ı/İ/î→i, ş→s, ğ→g, ü/û→u, ö→o, ç→c, â→a, upper case too),
  lower case, every run of other characters becomes one `-`, trimmed, at most 80 characters, empty
  becomes `x`.
- Adoption post: `{animal name, else species}-{district slug if linked}-{first 6 hex of the id}`,
  then `-2`, `-3`, ... on collision (UUIDv7 ids share their leading hex for hours). Set once at
  creation and never changed by later edits.
- Care place: `{name}-{district slug if linked}`, numeric suffix on collision, also fixed after creation.
- Both are unique indexes. Creation picks the slug check-then-insert; if a concurrent insert takes it
  first (unique violation on the slug index) the save is retried with fresh slugs, at most 3 attempts,
  then the API answers 409 `slug_conflict`.
- The migration backfills set-based: a base slug per row, `row_number()` per base in id order for the
  `-2`, `-3` suffixes, then repeated duplicate-only passes until nothing collides. Deterministic.
- Old closed adoption posts keep `ClosedReason = null` (unknown); the migration does not guess.
