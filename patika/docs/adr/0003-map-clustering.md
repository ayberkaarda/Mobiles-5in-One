# ADR-0003: Map clustering

- Status: Accepted
- Date: 2026-10-25

## Context

The map can contain many stations and animal locations. Sending every individual point at low zoom increases response size and makes the map difficult to read. The database already uses PostGIS for spatial queries, and map responses need consistent limits and pagination.

## Decision

Perform clustering on the server using a grid derived from the requested zoom level. Use PostGIS `ST_SnapToGrid` to group points and return cluster coordinates and counts; return individual features when the zoom and density permit. The client renders the returned clusters and individual features and requests updated results when the visible bounds or zoom changes. Validate bounds and cap each response according to the API contract.

## Consequences

Clustering behavior is consistent across clients, and the API can bound payload size before transmission. Grid resolution is a server-owned policy and can be tuned without a mobile release. Clusters represent grid cells rather than exact geographic density surfaces, so visual styling must communicate counts clearly and the client must not independently merge server clusters.
