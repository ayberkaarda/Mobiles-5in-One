# ADR-0036: Map tile factory and coarse recipient location

- Status: Accepted
- Date: 2026-10-04
- Deciders: Ayberk (owner) delegated engineering decisions inside the specification.

## Context

ADR-0003 chose a keyless tile source with a self-hosting path. The app shows shops on a map for donors
and merchants and as a list for recipients. A recipient must never reveal a precise position.

## Decision

### Tile factory

- `buildTileLayer(TileProvider)` in `lib/features/discovery/presentation/map_tiles.dart` is the only
  place that builds a tile layer. The URL template is one constant (`kTileUrlTemplate`, the keyless
  OpenStreetMap-compatible template) and the tile client package name is one constant. Moving to the
  self-hosted PMTiles archive of ADR-0003 changes this file only.
- The provider is a seam (`tileProviderProvider`): tests use a fake provider and make no network request.
- `MapAttribution` is shown on every map and must not overflow at narrow widths or large text.
- The usage-policy points of ADR-0003 remain unverified; flutter_map prints the tile policy notice in
  tests.

### Coarse recipient location

- Recipients use `CoarseLocationController`, which never asks for a precise position. It either reads
  the device position and rounds it to two decimals before use, or offers a district picker (14
  districts) when the permission is denied forever, the location service is off or there is no fix.
  A rationale appears before the permission request.
- The nearby query sends the rounded point with a 3000 m radius, widened to 5000 m (the specified
  maximum) on request; a test asserts the query is 41.06 / 28.99 for the sample position.
- The chosen district, radius and location are kept in memory only; a district user picks again after
  a cold start. Persisting the district was left out on purpose (no storage in the anonymous flow).
- Donors and merchants may use the precise device position (when in use) after a rationale and a tap:
  donors to find shops, merchants to place the shop pin.
- Android requests `INTERNET`, `ACCESS_COARSE_LOCATION` and `ACCESS_FINE_LOCATION`; the manifest test
  asserts them.

## Consequences

- No screen of the recipient flow can leak a position finer than roughly one kilometre.
- A recipient who denies location still gets a working list through the district picker.
- A tile policy change is a one-file change.

## Not exercised / limits

- Live tiles were not exercised (fake provider in tests); real device location was not exercised
  (fake location service), and the emulator flows use the district picker.
- Evidence: `test/features/discovery/**`, `test/features/recipient/**`, `test/core/android_config_test.dart`.
