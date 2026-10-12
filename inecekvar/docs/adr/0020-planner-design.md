# ADR-0020: A to B planner design

- Status: Accepted
- Deciders: Project owner (decision delegated to the lead)
- Phase: 2, package 2C

## Context

Section 3 story 3 asks for up to 3 itineraries with at most 2 transfers, walking edges of at
most 300 m between stops, an estimated fare, a server-side graph and a 10 minute cache per
city, origin cell and destination cell. Section 6.5 limits `plan` to 30 requests per minute per
IP; section 6.22 asks for a 3 second timeout with a degrade mode; the threat model lists planner
denial of service with pathological inputs.

## Decision

- Pure core (`app/planner/graph.py`, `app/planner/search.py`, no I/O): `build_network` builds a
  `networkx.MultiDiGraph` from the published current versions (ride edges both ways between
  consecutive stops; dolmus lines run in both directions) and walking edges between stops at most
  300 m apart, found through Earth-centred cubic buckets. Each stop keeps walking links to at most
  12 nearest stops (`WALK_NEIGHBOURS`), so a dense cluster cannot make the graph quadratic;
  a shortest spanning forest over all walkable pairs is added, so stops connected on foot stay
  connected on foot.
- `plan` searches states `(stop, line, transfers)` best first, rejects any path whose ride count
  exceeds `max_transfers + 1`, ranks by (transfers, ride stops + walk metres / 100), returns at
  most 3 itineraries distinct by their line sequence and checks a cooperative deadline, raising
  `PlannerTimeout`.
- Service (`app/planner/service.py`): one graph per `(city, pack_version)` kept in process (8
  cities), built in a worker thread under a per-city lock; a city with more than 20 000 active
  stops is not built and answers `degraded: true` with no itineraries. Access and egress: up to
  8 stops within 500 m of each end. Results are cached in Redis under
  `plan:v1:{city}:{pack_version}:{origin cell}:{destination cell}:{max_transfers}` with cells of
  3 decimals (about 100 m); the search runs from the cell centre, so equal cells give equal
  answers. Every approval or rollback bumps `pack_version`, which retires both caches.
- Timeout and degrade: the full search gets `planner_timeout_seconds` (3 s); on timeout a second
  search with at most 1 transfer gets 1 s; the response is 200 with `degraded: true` (empty when
  both time out) and is cached for 60 s only. A timeout never becomes a 500.
- `POST /v1/plan` is anonymous, rate limited by `rate_limit("plan")`, validates finite
  coordinates inside the stored city bbox (`422 plan.outside_city`) and logs only the city slug,
  the result count, `degraded` and the cache flag.

## Consequences

- The graph is not serialized to Redis (the specification allows in-process plus Redis); a cold
  process rebuilds per city on first use. The capacity limit is a fixed constant.
- Candidate pairs are still collected before the cap (quadratic in a pathological cluster);
  stops reach the graph only through moderated edits, and a city is refused above 20 000 stops.
- A thread that timed out keeps running until its own deadline check; at most one extra second of
  CPU per request, bounded by the rate limit.

## Evidence

Command: `INECEKVAR_ENV=test INECEKVAR_REQUIRE_DOCKER=1 uv run pytest tests/planner` (27 passed).

| # | Check | Test | Result |
| - | ----- | ---- | ------ |
| 1 | Never more than max transfers | `tests/planner/test_search.py::test_property_never_exceeds_max_transfers` (hypothesis, random networks, k = 0, 1, 2) | passed |
| 2 | Symmetric reachability | `test_property_symmetric_reachability` | passed |
| 3 | Well-formed itineraries | `test_property_itineraries_are_well_formed`, `test_direct_ride`, `test_one_transfer_at_shared_stop`, `test_transfer_through_walking_edge`, `test_no_walking_edge_for_301_m`, `test_fare_sum`, `test_ranking_prefers_transfers_then_cost` | passed |
| 4 | Timeout | `test_timeout_raises_planner_timeout`; API `tests/planner/test_api.py::test_plan_timeout_returns_degraded_not_500` (both variants) | passed |
| 5 | Bounds | `test_plan_outside_bbox_is_422`, `test_plan_unknown_city_404`, `test_plan_rejects_invalid_body`, `test_plan_rate_limited_31st_request` (429 + Retry-After) | passed |
| 6 | Cache | `test_plan_cache_hit_same_cell` (Testcontainers Redis) | passed |
| 7 | Denial of service caps | `test_walking_links_are_capped_per_stop`, `test_walking_cap_keeps_walkable_clusters_connected`, `test_plan_city_beyond_capacity_degrades` | passed |
| 8 | Sample city | `test_plan_sample_city_one_transfer`, `test_plan_respects_max_transfers_zero` | passed |
| 9 | Logs | `test_plan_log_has_no_precise_coordinates` | passed |
| 10 | Mutation M6 | ride limit `max_transfers + 1` changed to `+ 2` | 4 failed (`test_property_never_exceeds_max_transfers`, `test_one_transfer_at_shared_stop`, `test_transfer_through_walking_edge`, `test_plan_respects_max_transfers_zero`); restored, file identical |
| 11 | Mutation M10 | spanning forest removed from the walking links | `test_walking_cap_keeps_walkable_clusters_connected` failed; restored |

Not exercised:

- `not exercised: CPU-alert driven degrade mode` (cost alerts are phase 6; degrade is driven by the timeout here).
- `not exercised: load test against a large real city` (only the synthetic sample city and random networks exist).
