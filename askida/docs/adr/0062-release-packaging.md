# ADR-0062: Release packaging

- Status: Accepted
- Date: 2026-10-05
- Deciders: Ayberk (owner) delegated engineering decisions inside the specification.

## Context

The Definition of Done (specification section 12) asks for signing documentation without keys in
the repository, Docker images, a Caddy or nginx configuration and Horizon and scheduler
supervisors. There is no domain, no host, no store account and no macOS (ADR-0006).

## Decision

- One image for the three application roles, built from `docker/php/Dockerfile` (PHP-FPM 8.3 and
  nginx in one container): compose services `server` (HTTP, health `GET /up`), `horizon` (queue
  workers, `horizon:status`) and `scheduler` (`schedule:work`, exactly one instance). The compose
  roles are the supervisors; no separate process manager is added.
- The image installs the PostgreSQL 16 client from the PGDG repository (the Debian bookworm
  client is version 15 and refuses to dump a 16 server; see ADR-0058).
- Edge: `docker/caddy/Caddyfile.example` (one-host template): automatic HTTPS and the HTTP to
  HTTPS redirect, `reverse_proxy` to `server:80`, `/up` passed through with an active health probe,
  a JSON edge log that drops the `near` query parameter. HSTS comes from the application (two years,
  subdomains, preload) and is passed through, not duplicated. `TRUSTED_PROXIES` must name the proxy.
- The application nginx logs with the `askida_private` format (ADR-0055): no client address, no
  query string, `/pay/<token>` as `/pay/-`.
- `docs/ops/deploy.md`: roles, environment checklist, first start and updates, a zero-downtime
  note, maintenance mode with `php artisan down --secret`, rollback.
- Signing (`docs/release/signing.md`): Android upload key with Play App Signing, iOS certificates
  and profiles, keys kept only in the owner's secret store, `key.properties` ignored by git and
  documented by `app/android/key.properties.example` with dummy values; CI signing documented, not
  built.
- Public web caching: the in-house `cacheResponse` middleware and `SitemapXml` writer replace the
  `spatie/laravel-responsecache` and `spatie/laravel-sitemap` packages because their Laravel 13
  releases need PHP 8.4 and the stack is 8.3; that decision and its exit path are ADR-0043 and
  ADR-0048, not repeated here.

## Consequences

- The image is a **development image** (bind-mounted source, `composer install` at the first
  start). A production image (multi-stage, no dev packages, no bind mount, non-root user) is not
  built; it is an open proposal.
- The Android `release` build type still uses the debug signing config; reading `key.properties`
  is documented with a snippet but not wired, so no store-uploadable artifact can be built yet.
- `.env.example` sets `LOG_STACK=single`; production must set `LOG_STACK=daily` to get the 30-day
  rotation (`docs/ops/env.md`).
- Existing stacks keep the old `askida-server:local` image until it is rebuilt from the merged
  Dockerfile.
- not exercised: a deployment, the Caddyfile against a certificate authority (no domain;
  `caddy validate` not run, no binary), a rolling update with two containers, CI signing, store uploads,
  iOS.
