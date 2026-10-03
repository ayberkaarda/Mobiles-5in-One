# ADR-0003: Map tiles - keyless source, PMTiles self-hosting condition

- Status: Accepted (usage-policy points not verified, see "Not verified")
- Date: 2026-10-03
- Deciders: Ayberk (owner)

## Context

The app shows nearby shops on a map (`flutter_map`). A tile source normally needs either an API key
(which would have to ship inside the app binary, contradicting the rule that the binary carries
only `API_BASE_URL` and the public push client configuration) or a public community tile server,
whose usage policy may forbid heavy or app-embedded use.

## Options considered

1. Commercial tile provider with an API key: good quality and quotas, but a key in the client
   binary and a billing relationship.
2. Public community tile server without a key: no secret and no cost, but best-effort service and
   a usage policy that may not allow production app traffic.
3. Self-hosted PMTiles (a single static archive served over HTTP range requests, read in the app
   through `flutter_map_pmtiles`): no key, predictable cost on object storage or the VPS, and full
   control over coverage; needs a one-time tile build from open map data and attribution.

## Decision

- Default for development, demos and tests: a keyless source configured behind one tile-layer
  factory in the app, with attribution shown in the map UI.
- Condition for self-hosting: if the chosen source's usage policy does not allow the app's traffic
  pattern, or the project is deployed for real users, switch to a self-hosted PMTiles archive. The
  switch changes only the tile-layer factory and one static asset; no API contract changes.
- Tests never call a live tile server: widget tests use a fake tile provider, and a small PMTiles
  fixture may be used for the PMTiles code path.
- Recipients use coarse city-level location by default, so tile requests do not reveal a precise
  recipient position to any tile host chosen here.

## Not verified

- The current usage policy and rate limits of any specific keyless tile server were not checked.
- A PMTiles archive for any Turkish district was not built or measured (size, build time, required
  map-data attribution text).
- Dart package versions and their PMTiles support are resolved in ADR-0001.

## Consequences

- No map secret exists anywhere in the repository or the app.
- Real-world tile traffic is not exercised (see ADR-0006, gate G6).
- Self-hosting adds a build step and an asset to operate; it is deferred until the condition above
  is met.
