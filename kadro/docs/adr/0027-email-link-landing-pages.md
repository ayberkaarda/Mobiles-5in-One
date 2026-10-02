# ADR-0027: Email-link landing pages delivered with Phase 2 and Phase 3, not Phase 4

- Status: Accepted; page set, token handling and CSP detailed by [ADR-0040](0040-email-link-pages-phase2-scope.md)
- Date: 2026-10-01
- Deciders: Engineering (product spec §0.7), reported to Ayberk (owner)
- Related: product spec §10; ADR-0021, ADR-0026; threat model T-AUTH-08, RR-8

## Context

Verification and reset emails link to web pages on `kadro.app`: `/e-posta-dogrula#token=…`,
`/sifre-sifirla#token=…`, `/giris` and `/sifremi-unuttum`. The token is in the URL fragment so it
never reaches access logs or `Referer`. These pages do not exist yet. Phase 4 is the SEO and
marketing phase, but email links are part of the account flows: without the pages, no user can
verify an email or reset a password from an email.

## Decision

- **End of Phase 2:** the web app ships the four pages as app surfaces (nonce CSP group of
  ADR-0021, `noindex`). The verification and reset pages read the token from the fragment, remove
  it from the address bar with `history.replaceState` before any other script runs, and post it to
  `auth/verify-email` / `auth/reset`. They load no third-party resources.
- **Phase 3:** the same paths become universal links (iOS) and app links (Android). The
  `apple-app-site-association` and `assetlinks.json` entries for these paths ship with the Phase 3
  mobile build, ahead of the other Phase 4 app-linking paths. Without the app installed, the web
  pages above handle the link.
- Phase 4 adds nothing to these flows beyond copy and design polish.

## Consequences

- Open risk until the end of Phase 2 (RR-8): emails sent from preview contain links to pages that
  return 404, so verification and reset are testable only through API clients. No production
  traffic is accepted before these pages exist.
- The Phase 2 gate includes a Playwright flow: register → verification link → verified, and
  forgot → reset link → new password → all sessions revoked.
