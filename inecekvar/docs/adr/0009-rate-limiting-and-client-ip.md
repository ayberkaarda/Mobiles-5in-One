# ADR-0009: Rate limiting and the trusted client address

- Status: Accepted
- Deciders: Project owner (decision delegated to the lead)
- Phase: 1, package 1C

## Context

Section 6 item 5 asks for a Redis sliding window: `auth/login|register|magic-link|refresh` 5
per 15 minutes per IP **and** per normalized email, `edits` 10 per day below reputation 20 and
100 per day otherwise, `traces` 20 per day, `plan` 30 per minute per IP, answered with 429 and
`Retry-After`; the client IP comes only from Caddy's trusted header.

## Decision

- Rules live in `app/core/settings.py::RATE_LIMIT_RULES` with exactly the numbers above
  (`auth.login`, `auth.register`, `auth.magic_link`, `auth.refresh`, `edits.low_reputation`,
  `edits.default`, `traces`, `plan`). The edits, traces and plan rules are declared now and
  wired by the phase 2 endpoints.
- `RedisSlidingWindowLimiter` (`app/core/ratelimit.py`) keeps one sorted set per rule and
  subject and runs one Lua script per hit (trim, count, deny or add, `PEXPIRE`), so concurrent
  hits cannot overshoot. Keys are `rl:<rule>:<HMAC-SHA256(log_hash_key, subject)>`; neither an
  email nor an IP is stored in Redis. Time is the injected clock in milliseconds. A Redis error
  propagates and becomes a 500 problem: the limiter fails closed, never open.
- Subjects: `ip:<address>` through the `rate_limit(rule)` dependency; `email:<normalized>`
  (trimmed, lower case) inside the handler after the body is parsed and before any database
  work; `family:<uuid>` for refresh; `reauth:<user id>` on the login budget for account deletion
  re-authentication.
- 429 answers carry `Retry-After` in whole seconds (at least 1) and the problem code
  `rate_limited`.
- Client IP (`app/core/client_ip.py`): the ASGI peer, unless the peer is inside
  `INECEKVAR_TRUSTED_PROXY_CIDRS` (default `127.0.0.1/32`, `::1/128`) and the configured header
  `X-Real-IP` holds exactly one valid address. `X-Forwarded-For`, `Forwarded` and other headers
  are never read. Caddy sets the header with `header_up X-Real-IP {remote_host}`
  (`ops/Caddyfile`), overwriting anything the client sent.

## Consequences

- Behind a different proxy topology the trusted CIDRs must be configured, otherwise every
  client shares the proxy's bucket (safe, but strict).
- Plus addressing and dots in local parts are not folded: `a+x@` and `a@` are different
  subjects. The per-IP limit still bounds such variation from one address.
- A Redis outage turns limited endpoints into 500 answers.

## Evidence

Logs in the owner's job folder (`p1c-gate.log`, `p1c-mutation.log`, `p1-final-gate.log`,
`p1-final-mutation.log`).

| # | Check | Test | Result |
| - | ----- | ---- | ------ |
| 1 | 6th login in 15 minutes | `tests/auth/test_links_login.py::test_login_sixth_attempt_is_rate_limited`, `test_login_rate_limit_is_per_email_across_ips`, `test_register_rate_limited_per_ip` | passed (in-memory limiter double) |
| 2 | 6th login on real Redis | `tests/auth/test_rate_limit_real_redis.py::test_sixth_login_is_429_on_real_redis` | passed on Testcontainers `redis:7.4.11-alpine`: 429, `rate_limited`, `Retry-After` within 1..900, allowed again after it |
| 3 | Limiter on real Redis | `tests/core/test_ratelimit.py::test_sliding_window_sixth_hit_denied_on_real_redis`, `test_sliding_window_slides`, `test_limiter_keys_hide_subject`, `test_parallel_hits_are_atomic`, `test_unknown_rule_fails_closed`, `test_redis_error_propagates`, `test_rules_match_spec`, plus the fakeredis variant (Lua through `lupa`) | passed |
| 4 | HTTP stack 429 | `tests/core/test_handlers.py::test_sixth_request_returns_429_with_retry_after`, `tests/core/test_middleware.py::test_limiter_failure_returns_problem` | passed |
| 5 | Spoofed `X-Forwarded-For` ignored | `tests/core/test_client_ip.py::test_spoofed_x_forwarded_for_ignored`, `test_trusted_proxy_header_used`, `test_invalid_trusted_header_falls_back_to_peer`, `test_resolve_client_ip` (parametrized) | passed; mutation M4 (trust `X-Forwarded-For`) fails `test_spoofed_x_forwarded_for_ignored` |

Not exercised:

- `not exercised: Caddy in front of the API` (the Caddyfile change was not run through the
  compose proxy in this package; the header rule is covered at the API boundary only).
- `not exercised: edits, traces and plan limits` (phase 2 endpoints).
