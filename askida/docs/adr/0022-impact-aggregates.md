# ADR-0022: Impact aggregates and the small-cell rule

- Status: Accepted
- Date: 2026-10-04
- Deciders: Ayberk (owner) delegated engineering decisions inside the specification.

## Context

Story 8 shows the public how much was donated and taken, by district. The numbers must not single
out a donation, a shop or a person (draft rule D-4 of the authorization matrix).

## Decision

- Methodology key `impact.v1.daily_units`. Per calendar day (Europe/Istanbul) and the shop's il and
  ilce: `donated` is the sum of `qty` of `paid` donations by `paid_at`; `redeemed` is the count of
  `REDEEMED` hooks by `redeemed_at`; `shops` is the count of verified shops at snapshot time. Sample
  shops and everything attached to them are excluded. Counts only, no per-shop or per-person data.
- Job `impact.snapshot` (hourly, unique for one hour, without overlap) recomputes yesterday and
  today and upserts `impact_snapshots` on (il, ilce, day); districts that went quiet that day are
  zeroed.
- `GET impact?il=&ilce=` is public and cached for 5 minutes per (il, ilce). `ilce` requires `il`.
  The answer is `{data: {day, level, il, ilce, donated, redeemed, shops, methodology}}` for the latest
  snapshot day.
- Small-cell rule (settles D-4): a district is shown on its own only when it has at least 3 verified
  shops (`ImpactReader::MIN_SHOPS_PER_CELL`); otherwise the answer rolls up to the province, then to
  the country. `level` is `ilce`, `il` or `tr` and says which was returned.

## Consequences

- Three shops is a privacy heuristic, not a statistical guarantee; a district with three shops and
  one active donor can still be inferred by someone who knows the district.
- The endpoint has no rate limiter of its own because it is cached; a light per-address limiter is a
  suggestion, not built.
- Evidence: `tests/Feature/Api/Impact`. The CORS rule of ADR-0011 applies to browser callers.
