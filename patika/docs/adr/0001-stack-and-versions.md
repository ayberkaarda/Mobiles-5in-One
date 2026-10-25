# ADR-0001: Stack and versions

- Status: Accepted
- Date: 2026-10-25

## Context

Patika needs an Android-first mobile client, a spatial API, public SSR web pages, background processing, and automated tests. The repository is developed on Windows and has no Mac build host. The phase 0 specification calls for pinned, reproducible tool and dependency versions.

## Decision

- Use .NET SDK `10.0.400` and target `net10.0` for Domain, Contracts, Infrastructure, Api, Web, and Worker.
- Implement the API with ASP.NET Core Minimal APIs and the public/admin site with Razor Pages.
- Use EF Core with Npgsql and NetTopologySuite against PostgreSQL 17 with PostGIS 3.5.
- Use Quartz.NET for scheduled worker jobs and xUnit for automated tests.
- The mobile client is .NET MAUI targeting `net10.0-android` first. No iOS target is built in this repository for now because the available build host is Windows and no Mac is available.
- Store NuGet version pins centrally using Central Package Management. Keep resolved versions recorded in this ADR as dependencies are selected.
- Use MinIO for local object storage and Cloudflare R2 in production; Resend for email; Firebase Cloud Messaging (FCM) for Android push initially, with APNs as a later platform addition.

## Consequences

The stack aligns the backend and mobile client around C# and supports Android builds on the available host. iOS build and release work requires a Mac host and is outside the current repository build. Local development can exercise storage through MinIO; production uses the S3-compatible R2 service. Package versions must be reviewed and updated here when central pins change.
