# ADR-0003: Open data licence

- Status: Proposed; legal approval pending
- Deciders: Project owner and legal reviewer

## Context

The product proposes weekly public GeoJSON exports and contributor submissions. Publishing a licence grants reuse rights and requires an authorized decision. Route geometry must not be derived by snapping contributed line geometry to OpenStreetMap roads, which could create an ODbL share-alike relationship for the contributed dataset.

## Decision

Propose CC BY 4.0 for the project dataset, subject to legal approval. No licence is granted yet; do not publish a machine-readable licence declaration or describe the export as already licensed. Keep OpenStreetMap contributors' base map attribution and ODbL terms separate from the project dataset.

Do not snap submitted route geometry to OSM roads. Geometry validation and simplification must preserve the distinction between contributed route data and the OSM base map.

## Consequences

The public data licence remains unresolved pending legal review. Contributor-facing acceptance and export claims must wait for approval. Base map attribution and ODbL obligations apply to the base map independently.
