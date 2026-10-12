# ADR-0024: Offline city packs and the first-city entitlement

- Status: Accepted
- Deciders: Project owner (decision delegated to the lead)
- Phase: 2, package 2D

## Context

Section 3 stories 4 and 8: a JSON dataset per city plus a PMTiles basemap; the free tier gets one
city, Plus unlimited; the entitlement is enforced server-side for pack downloads beyond the first
city. Section 6.22 asks for a pack download rate limit per anonymous hash and day. RevenueCat is a
fake adapter until phase 5 (K2).

## Decision

- `GET cities/{slug}/pack` returns the published dataset (`format: 1`, city, `pack_version`,
  lines with geometry, ordered stop slugs, fare, hours, payment methods, hail notes, stops) and
  nothing about authors, publishers, edits, photos or traces (`app/export/dataset.py`).
- Identity: the network identity `anon_hash = HMAC-SHA256(log_hash_key, "pack-anon:" + trusted
  client IP)` (32 bytes, the raw IP is never stored) always counts; a signed-in caller adds the
  account identity. Both are charged against `pack.download` (10 per day each), and both are
  serialized with transaction advisory locks (account before network).
- First city: the city of the earliest `pack_downloads` row of the identity that decides: the
  account for a signed-in caller (a shared network must not take away an account's free city),
  the network identity otherwise. Another city needs `has_plus` from `Services.entitlements`
  (`SubscriptionEntitlements`: an `active` or `grace` subscription not expired); otherwise
  `403 pack.entitlement_required`. No entitlement source means no Plus. One row is recorded per
  identity, city and day; signed-in rows are stored under the account only.
- Because a download can select the free city, the route requires the header
  `X-Pack-Request: 1`, declared as a required header in the contract (missing: 422
  `validation.failed`; any other value: 400 `pack.header_required`). Browsers send a custom header only
  from code on an allowed origin after a CORS preflight, so a cross-site link or image cannot
  pick a victim's city; the header is in the CORS allowlist.
- `GET cities/{slug}/tiles.pmtiles` redirects (302) to `INECEKVAR_PMTILES_BASE_URL/<slug>.pmtiles`
  when configured (https only) and is 404 `tiles.not_configured` otherwise.

## Consequences

- An IP address is a weak identity (shared networks share the anonymous first city; a new
  network gets a new one), and one person can hold an anonymous free city and an account free
  city. Accounts need a verified mailbox, which bounds this. A durable device identity would
  need a stored client id; the phase 3 app may add it.
- Plus purchase, webhooks and reconciliation arrive in phase 5; until then only test doubles
  grant Plus.

## Evidence

Command: `INECEKVAR_ENV=test INECEKVAR_REQUIRE_DOCKER=1 uv run pytest tests/export` (29 passed).

| # | Check | Test | Result |
| - | ----- | ---- | ------ |
| 1 | First city free | `tests/export/test_packs.py::test_first_city_pack_is_free_anonymous` | passed |
| 2 | Entitlement beyond the first city | `test_second_city_needs_entitlement` (anonymous and signed-in 403, Plus 200), `test_account_history_decides_for_signed_in_downloads`, `tests/export/test_entitlements.py::test_subscription_entitlement_status_and_expiry` | passed |
| 3 | Quota per anonymous hash | `test_pack_download_rate_limit_per_anon_hash` (11th is 429, another IP 200), `test_pack_anon_hash_not_raw_ip` | passed |
| 4 | Cross-site trigger refused | `test_pack_requires_request_header` (wrong value 400, missing 422, nothing recorded) | passed |
| 5 | No trace data | `test_pack_has_no_trace_data`, public scanner probe | passed |
| 6 | Tiles | `test_tiles_redirect_only_when_configured` | passed |
| 7 | Mutation M5 (final code) | entitlement check reduced to the first download only | 2 failed (`test_second_city_needs_entitlement`, `test_account_history_decides_for_signed_in_downloads`); restored |

Not exercised:

- `not exercised: PMTiles archives and CDN` (no host; phase 6 recipe).
- `not exercised: RevenueCat entitlement` (phase 5; fake source in tests).
