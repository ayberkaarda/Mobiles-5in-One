# ADR-0020: Routes exempt from the client type header

- Status: Accepted; amends [ADR-0014](0014-client-type-and-session-transport.md)
- Date: 2026-10-01
- Deciders: Engineering (product spec §0.7), reported to Ayberk (owner)
- Related: authorization matrix §2, §3.7; threat model T-AUTH-14, T-PLT-17

## Context

ADR-0014 requires `x-kadro-client` on every `/api/v1/**` request and exempted only the RevenueCat
webhook. Container health checks (Docker `HEALTHCHECK`, Caddy upstream checks, the uptime monitor)
call `GET /api/v1/health` and cannot be expected to send an application header; failing them with
400 would mark healthy containers as down.

## Decision

The complete list of routes exempt from `x-kadro-client`:

| Route                              | Why exempt                              | What the route still enforces                                                              |
| ---------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------ |
| `GET /api/v1/health`               | Infrastructure probes                   | No credentials read; no database writes; response is status and build SHA only; `no-store` |
| `POST /api/v1/webhooks/revenuecat` | Called by RevenueCat, no user principal | Shared-secret check, raw body, replay protection (matrix footnote 25)                      |

- Exempt routes never read cookies or `Authorization` as user credentials, so the missing header
  cannot select a credential transport.
- Adding a route to this list requires a new ADR and a matching row in matrix §3.7.
- Every other `/api/v1/**` route keeps the ADR-0014 rule: missing or unknown header → 400.

## Consequences

- Health probes work without custom headers; the route reveals nothing beyond liveness and build
  SHA (threat T-PLT-17).
- The route wrapper holds the exempt list as a constant; a test asserts that exactly these two
  routes skip the header check.
