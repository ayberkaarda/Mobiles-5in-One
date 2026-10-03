# ADR-0002: Hosting and payment provider

- Status: Accepted (provider behaviour not verified, see "Not verified"; cost and legal points are open for the owner)
- Date: 2026-10-03
- Deciders: Ayberk (owner)

## Context

Askida runs these processes in production:

1. `server` - Laravel (`/api/v1`, Blade web pages, Filament admin) behind php-fpm and nginx.
2. `horizon` - Laravel queue workers on Redis (webhook processing, reconciliation, push fan-out,
   mail, deletion jobs).
3. `scheduler` - `php artisan schedule:work` (reconciliation, expiry, backup, cost guard).
4. PostgreSQL 16 with PostGIS, Redis, and S3-compatible object storage (private documents, public
   photos, backups).

Two decisions are recorded together because they constrain each other: where the stack runs, and
which provider moves the money. The product invariant is that the platform never holds funds:
money flows donor -> payment provider -> merchant sub-merchant payout, and the platform books only
its commission.

## Options considered

### Hosting

- Managed PaaS (container platform with managed Postgres and Redis): less operations work, but
  PostGIS availability, a long-running Horizon process and per-service billing differ per vendor,
  and cost is harder to cap.
- Docker Compose on a single VPS behind Caddy (chosen): one private network and one fixed monthly
  bill, the same images locally and in production, automatic HTTPS and HSTS from Caddy, explicit
  data location. Operations (patching, upgrades, backups, monitoring) are ours; availability is
  single-host.

### Payment provider

- iyzico with Checkout Form and the marketplace sub-merchant scheme (chosen as primary): the
  specification requires donor payments to reach a shop's sub-merchant account without the
  platform holding funds.
- PayTR (recorded fallback): reachable through the same `PaymentGateway` contract; it is not
  implemented unless iyzico becomes unavailable to the project.

## Decision

### Hosting

Production runs on one Linux VPS with Docker Compose:

- `caddy` (TLS termination, HSTS, forwarded-address handling) -> `nginx` -> `php-fpm` (`server`).
- `horizon` and `scheduler` use the same application image as `server`.
- `postgres` (PostGIS) on a persistent volume, not exposed publicly; `redis` not exposed publicly.
- Object storage is S3-compatible (Cloudflare R2 in production, MinIO locally), with a private
  bucket for documents and backups and a public bucket for shop photos.
- Local development uses `docker-compose.yml` with `postgres`, `redis`, `minio`, `mailpit`,
  `server`, `horizon` and `scheduler`, independent of this decision.

Differences from the Kadro hosting record (same pattern: Docker on a VPS behind Caddy):

- Askida needs Redis (Horizon queues, cache, rate limits); Kadro uses Postgres only.
- Askida needs PostGIS in the database image.
- Askida runs php-fpm with nginx instead of a Node server, plus a scheduler process.
- Askida has an object-storage dependency for private documents from Phase 2.

Sizing, region and the production Caddyfile are delivered with the release-readiness work (Phase
6). The exact VPS size is not decided here.

### Payment provider and contract

The server depends on a `PaymentGateway` interface, never on a provider SDK type. The contract
(final method signatures are fixed in Phase 3 and recorded in the OpenAPI document and the payment
ADR of that phase):

- Create a checkout for a donation: input is the donation id and the amount in integer minor units
  (kurus, currency `TRY`) computed on the server from `items.price_minor`; output is a provider
  token and a checkout page URL. An amount sent by the client is never trusted.
- Retrieve a payment by provider id or token: the only source of truth for a status transition.
  Callbacks and webhooks never carry a trusted status; they trigger a retrieve.
- Verify a webhook: signature check on the raw body, timestamp tolerance, idempotency by event id.
- Onboard and update a shop sub-merchant, returning the provider's sub-merchant key stored as
  `shops.sub_merchant_key`.
- List settlements for reconciliation and payout views.

Implementations: `iyzico` (real adapter) and `fake` (selected by `PAYMENT_PROVIDER=fake`, allowed
only in `local` and test environments; configuration validation rejects it elsewhere). `paytr`
stays a documented alternative behind the same interface.

Platform never holds funds: no code path credits a platform-owned balance with donor money other
than the commission amount, and payout views are read-only mirrors of provider settlements.

## Not verified

The following were not checked against current provider documentation or a sandbox when this
record was written and must be confirmed before Phase 3 implementation:

- Whether the iyzico sandbox enables the marketplace (sub-merchant) feature for a new account.
- The exact iyzico webhook signature algorithm and header names (the specification says "exactly per
  iyzico's current webhook specification").
- PayTR marketplace capabilities and whether it offers an equivalent sub-merchant scheme.
- Any commission, settlement-delay or onboarding-document requirements of either provider.

## Consequences

- Provider-specific code is isolated in one adapter folder; switching to PayTR changes the adapter,
  its fixtures and onboarding documents, not controllers or models.
- Tests run against `Http::fake()` fixtures of provider responses. They prove consistency with our
  own contract, not behaviour of the live provider (see ADR-0006, gate G1).
- Operations runbooks (provisioning, deploy, backup and restore, cost alerts) live in `docs/ops/`
  and are delivered in Phase 6.
- Single-host availability and a recovery point of up to 24 hours (daily backup) are accepted for
  a portfolio deployment.

## Open points for the owner

- Cost: monthly VPS and storage budget; provider fees and commission are not known.
- Data location under KVKK: a Turkiye-hosted VPS keeps the primary database in-country; other
  regions make it a cross-border transfer. Confirm before any real deployment.
- A real launch needs a signed marketplace agreement with the payment provider and legal review.
  This record is not legal advice.
