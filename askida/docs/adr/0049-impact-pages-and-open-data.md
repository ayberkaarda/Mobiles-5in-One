# ADR-0049: Impact pages and the open data CSV

- Status: Accepted
- Date: 2026-10-05
- Deciders: Ayberk (owner) delegated engineering decisions inside the specification.

## Context

Story 8 asks for public impact figures. ADR-0022 fixed the methodology (`impact.v1.daily_units`)
and the small-cell rule (a district is shown alone only with at least 3 verified shops). Publishing
the same series as a download invites reuse, which raises the question of a licence.

## Decision

- `/etki` (cache 300 s): last 30 days of donated and redeemed units and verified shops, a table per
  province linking `/etki/{il}`, the methodology and the download block. `/etki/{il}` slugs come from
  `TurkishSlug::make()`; an unknown slug is 404. A province below 3 shops answers 200 with an
  explanatory sentence, no figures and `noindex,follow`; districts below 3 shops are pooled as
  "Diğer ilçeler", provinces as "Diğer iller".
- `/etki.csv`: `text/csv; charset=utf-8`, header `day,il,ilce,donated,redeemed,shops`, last 90 days
  per day, the same small-cell pooling as the pages, so the open data never shows a cell the pages
  hide. Cells that start with `= + - @`, tab or CR get a leading `'`, because il and ilce are
  owner-typed text. Own cache of 3600 s (`Cache::remember` plus `Cache-Control: max-age=3600`), not
  behind the page cache.
- Sample data: sample-shop figures appear on the pages only when sample shops are allowed and the real
  window is all zero, labelled `[ÖRNEK]`. The CSV never contains sample figures (header only in that
  mode).
- Counters (`CountersReader`, `DbCountersReader`) cache plain arrays for 5 minutes, never objects.
- `Dataset` JSON-LD: name, description, url, `inLanguage`, `isAccessibleForFree`, `creator`,
  `temporalCoverage` (the CSV's 90-day interval), `spatialCoverage` Türkiye, `distribution`
  (`DataDownload`, `text/csv`). There is no `license` property. The page prose and the description end
  with: "Önerilen lisans: CC BY 4.0; hukuki onay bekliyor, henüz lisans verilmemiştir." A test
  asserts the key is absent.

## Open legal question

CC BY 4.0 is a proposal only. A machine-readable `license` would be an actionable grant that nobody
with authority has approved, so none is published. Decision needed from the owner after legal review:
which licence (if any) covers the CSV, and who is named as the rights holder (the data controller is
itself open, ADR-0051). Until then the data is shown, not licensed.

## Consequences

- Worst case measured in a throwaway test (81 provinces, 3 districts each): `/etki` 3 238 bytes
  gzip-9, 19 244 raw; the CSV with 243 rows is 10 457 bytes.
- not exercised: live check of the impact pages on a running stack (the dev database of that stack was
  not migrated; behaviour is covered by feature tests through the HTTP kernel), Dataset search
  validation on a public URL (no domain), real impact data.
