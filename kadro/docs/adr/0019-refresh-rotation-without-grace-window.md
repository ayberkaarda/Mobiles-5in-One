# ADR-0019: Refresh rotation without a grace window; clients refresh single-flight

- Status: Accepted
- Date: 2026-10-01
- Deciders: Engineering (product spec §0.7), reported to Ayberk (owner)
- Related: product spec §6 item 12; ADR-0014; authorization matrix §3.1 footnote 1; threat model
  T-AUTH-05

## Context

Refresh tokens (mobile) and web session tokens rotate on every use, and presenting a revoked token
revokes the whole family (reuse detection). Many implementations add a short grace window in which
the just-rotated token is still accepted, so that two concurrent refresh calls from the same device
do not log the user out. A grace window also lets a stolen token be replayed inside that window
without triggering reuse detection.

## Decision

- Phase 1 has **no grace window**. Rotation revokes the presented row with a conditional update
  (`… WHERE id = $id AND revoked_at IS NULL`); if zero rows change, the request is a concurrent use
  of the same token and is handled exactly like reuse: the family is revoked and the response is
  401 `unauthenticated`.
- Two concurrent refreshes from the same device are therefore indistinguishable from theft and log
  that device out.
- A token presented over the other client's transport (ADR-0014) is rejected with 401 without
  touching the family.

## Client requirements

- **Mobile:** all refresh calls go through one single-flight gate. While a refresh is in flight,
  every other request that needs a new access token awaits the same promise; no second refresh
  call is started. The new refresh token is written to `expo-secure-store` before the gate
  resolves. Background tasks and app-resume handlers use the same gate.
- **Web:** the same single-flight gate applies inside a tab, and across tabs the refresh call runs
  under one Web Locks API lock (`navigator.locks.request('kadro-refresh', …)`), so only one tab
  rotates the session cookie at a time; the others wait and then reuse the new cookie.
- A 401 from refresh means "log in again"; clients do not retry it.

## Consequences

- Strongest reuse detection: any replay of a rotated token, by an attacker or by a client bug,
  revokes the family.
- A client bug that breaks single-flight shows up as unexpected logouts; the mobile test suite
  includes a concurrent-401 case that asserts one refresh call.
- Revisit in a later phase only with telemetry showing family revocations caused by legitimate
  concurrency; any change is a new ADR.
