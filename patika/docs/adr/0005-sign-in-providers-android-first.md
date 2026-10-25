# ADR-0005: Sign-In Providers, Android First

- Status: Accepted
- Date: 2026-10-25

## Context

Android is the first client. The iOS client has not yet been built, so Sign in with Apple is deferred until that client is built.

## Decision

Phase 1 implements email and password sign-in plus Google ID token sign-in. The server verifies each Google ID token's signature against Google's JWKS and validates `aud` against the Android client id, as well as `iss` and `exp`.

Both external providers use one external-login abstraction backed by an `external_logins` table with `provider` and `subject` fields. Apple can be added through this abstraction without a schema change.

## Consequences

When the iOS client ships, App Store guideline 4.8 applies and Apple sign-in must then be offered.
