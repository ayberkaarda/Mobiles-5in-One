# ADR-0004: Capacitor plugin allowlist and secure storage

- Status: Proposed
- Deciders: Project owner

## Context

The mobile application uses Capacitor for foreground location, offline city packs, native sharing and deep links. Native refresh tokens require platform-backed secure storage. The product specification identifies a narrow plugin set and separates sensitive credentials from ordinary preferences.

## Decision

Allow only these Capacitor plugins: `geolocation` for foreground, when-in-use location; `filesystem` for native offline packs; `network`; `share`; `app` for deep links; a Keychain and Keystore-backed secure storage plugin for native refresh tokens; and `@revenuecat/purchases-capacitor` for native purchases only. `preferences` may hold non-sensitive settings only and is not secure storage.

Keep access tokens in memory and native refresh tokens in secure storage. Web and PWA use the specified HttpOnly session-cookie strategy and CSRF header. No plugin outside this allowlist may be added without a recorded decision updating this ADR.

## Consequences

Plugin review has an explicit boundary. Location access is foreground only. Sensitive tokens are not stored in preferences or ordinary filesystem storage. Plugin versions and platform support remain to be resolved with the application dependencies.
