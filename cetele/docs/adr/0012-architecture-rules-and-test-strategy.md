# ADR-0012: Architecture rules and test strategy

- Status: Accepted
- Date: 2026-10-05
- Deciders: Ayberk (owner)

## Context

Tenant isolation and parameterised queries (spec section 6 items 4 and 15) depend on every future
query being written the right way. Review alone does not scale across five phases, so the rules
are executable and run in `./gradlew check`.

## Decision

### Packages (`app.cetele.server`)

`config` (security chain, JWT, client IP, guard, OpenAPI, logging), `security` (current user, JWT
codec and filter, trace id, headers, body limit, permission model), `web` (problem handling,
validation annotations), `auth` (`otp`, `token`, `device`, `integrity`, `sms`, `ratelimit`,
`user`, `web`), `tenancy` (`shop`, `membership`, `invitation`, `web`, evaluator, resolver, context).
Controllers call services; services call repositories.

### ArchUnit rules (`ArchitectureTest`)

| #   | Rule                                                                                                                                                                        |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | A type implementing `TenantScoped` is only stored or removed through a `TenantRepository`.                                                                                  |
| 2   | Every method declared in a `TenantRepository` has a parameter named `shopId`.                                                                                               |
| 3   | No `createNativeQuery`, no `@Query(nativeQuery = true)` and no Spring Data `@NativeQuery` outside an allowlist. The allowlist is empty in Phase 1; Phase 2 adds `..sync..`. |
| 4   | Every handler method with a mapping annotation in `..tenancy.web..` has a method-level `@PreAuthorize`.                                                                     |
| 5   | `..web..` and `..auth.web..` classes depend on no repository type (Spring Data repository, `@Repository` or a class in a `repository` package); services only.              |
| 6   | No class outside `..config..` reads `System.getenv`.                                                                                                                        |

Each rule is proven not to be vacuous: fixtures under `src/test/kotlin/app/cetele/archfixtures`
(outside the scanned package) contain a violating class per rule and the test asserts that the rule
reports it, in addition to the single test that runs all rules on production classes.

### Known gap: `JdbcClient` and `JdbcTemplate`

Rule 3 covers JPA native queries and Spring Data native annotations. Plain JDBC access is used in
four classes: in auth two `JdbcClient` classes, `auth.UserStore` (user upsert with `ON CONFLICT`,
no second JPA entity on a table another module owns) and `auth.AuthLocks` (the advisory locks of
[ADR-0005](0005-session-model.md)); `tenancy.UserDirectory` (read-only user lookups through
`NamedParameterJdbcTemplate`); and the `JdbcTemplate` that `SecurityConfig` hands to the
authentication filter (the deactivated-user check). All use bound or named parameters and no
string-built SQL, but no architecture rule enforces that, and the rule 3 allowlist is still empty.
Decision: this use is accepted as is; allowlisting exactly these classes, or extending rule 3 to
forbid string-built SQL in them, is a proposal for Phase 2. Until then item 15 of the
[verification matrix](../security/verification-matrix.md) is `partial`.

### Test strategy

- Integration tests use the existing `@IntegrationTest` (profile `test`, Testcontainers
  PostgreSQL 16, one Spring context for the whole run) with `TestAuth`: a user row inserted by JDBC
  and a real ES256 token from the test codec. Fixture phone numbers are built at run time from
  `+9055` plus digits by `TestUsers`; no secret-shaped literal exists in the tests.
- `LogCapture` wraps output capture for the masking tests.
- Negative tests per constraint (`ShopValidationTest`, `OtpRequestTest`, `ProblemTest`) and
  table-driven tests over every endpoint and role (`PermissionEnforcementTest`), with a coverage
  test that fails when a shop endpoint is missing from the table.
- Mutation checks by hand for the critical controls: each was broken once, the matching test failed
  and the file was restored (dropped shop filter, removed `@PreAuthorize`, weakened action, removed
  invited-phone check, removed family revoke, 6 attempts instead of 5, constant HMAC key, removed
  phone bucket). This is a one-time check recorded in the phase report, not an automated mutation
  run.
- Concurrency tests (`RefreshRaceTest`, `OtpIssueRaceTest`) force the interleaving by holding a row
  lock and polling `pg_stat_activity` for lock waiters, with no sleeps; each failed against the
  code before the locks were added.
- `TrustedProxyTest` starts a second context on a random port (about 5 seconds more per run).
- `/v1/me` reads memberships through `tenancy.MembershipQuery`, so the auth module holds no
  membership SQL (`MeTest`, `MembershipQueryTest`).

### OpenAPI export

springdoc (API only, no UI) serves `/v3/api-docs` in `local` and `test`. `OpenApiSnapshotTest`
fetches it through MockMvc on every test run and writes `server/build/openapi/openapi.json`. The
lead copies that file to `docs/api/openapi.json` ([docs/api](../api/README.md)); a comparison test
against the committed file arrives in Phase 2. The fixed server entry is `https://cetele.app`.

## Consequences

- A new tenant repository method without `shopId` fails the build. A new tenant handler without
  `@PreAuthorize` fails the build. A new native query fails the build until it is allowlisted in a
  reviewed change.
- The rules see declared structure, not behaviour: they do not prove that a query uses its
  `shopId` correctly. That is the job of `TenantIsolationTest`.
- Tenant types are matched by simple name (`TenantScoped`, `TenantRepository`); moving them to
  another package needs no rule change, renaming them does.
- Evidence: `ArchitectureTest`, `PermissionEnforcementTest`, `TenantIsolationTest`,
  `OpenApiSnapshotTest`.
