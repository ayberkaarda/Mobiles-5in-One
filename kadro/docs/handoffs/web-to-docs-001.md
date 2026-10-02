# Handoff web → docs (security / ADR owner) 001

- From: `apps/web` auth endpoints (Phase 1)
- To: owner of `docs/security/` and `docs/adr/`
- Status: resolved (ADR-0025 family check; ADR-0026 email delivery and transport; ADR-0027 email-link pages; matrix §2, footnotes 1 and 3, logout row; threat model T-AUTH-05/06/08/13/15/18, RR-8..10)

Implementation choices in `apps/web/lib/server/auth/**` that the matrix, threat model or an ADR
should record. Each is implemented and tested as described.

1. **Access JWT after logout / reset.** Logout and password reset revoke the refresh family
   (mobile) or session row (web) immediately. A mobile access JWT already issued stays valid until
   its `exp` (at most `ACCESS_TOKEN_TTL_SECONDS`, 15 min), because `authenticate()` checks the
   user row (ADR-0012) but not the family. Either accept this residual window in the threat model
   (T-AUTH-05 / T-AUTH-13) or decide that mobile authentication also checks that `sid` has an
   unrevoked row (one more indexed lookup per request).
2. **Refresh after logout counts as reuse.** Presenting a revoked token is reuse by the
   `evaluateRefresh` rule, so a client that refreshes with a logged-out token produces an
   `auth.refreshReuse` audit row. Harmless (the family is already revoked); worth a sentence in
   matrix footnote 1 so audit reviewers do not read it as theft.
3. **Password reset marks the email verified.** Redeeming a reset link proves control of the
   mailbox, so `email_verified_at` is set if it was null. This affects provider linking
   (footnote 3), which requires a verified email on the account.
4. **Provider sign-in details.** A provider token without an email cannot create an account
   (401 `token_invalid`); a provider subject different from the one already linked is
   409 `account_link_required`; a provider key set that cannot be fetched (timeout 3 s, no cached
   keys) answers 503 `service_unavailable` with `Retry-After`. JWKS are cached 1 h and refetched on
   an unknown `kid` at most once per 30 s. Google requests that carry a nonce must match the
   token's nonce, and a nonce-bound token is refused in a request without one.
5. **Email links.** Links use the web origin and carry the token in the URL fragment
   (`/e-posta-dogrula#token=…`, `/sifre-sifirla#token=…`, plus `/giris`, `/sifremi-unuttum`), so
   tokens never reach access logs or `Referer`. These pages do not exist yet (web UI phase); the
   mobile app needs universal / app links for the same paths.
6. **Email transport.** `EMAIL_TRANSPORT=log|resend` (`@kadro/config`); `log` is refused outside
   `APP_ENV=local` by both the config schema and the transport factory. Preview and production
   need `EMAIL_TRANSPORT=resend`, `RESEND_API_KEY` (add to the secret rotation list of the
   history-purge runbook) and `EMAIL_FROM`.
7. **`GET me` `avatarUrl`** is always `null` until uploads ship (no public media base URL in the
   configuration yet).
8. **Metrics.** ADR-0018's alert ratio uses the counters `password_breach_check` and
   `password_breach_check_unavailable` (structured log lines with `metric`); email delivery
   failures are counted as `email_delivery_failed`.
