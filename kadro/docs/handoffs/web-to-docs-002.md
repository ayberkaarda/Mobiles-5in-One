# Handoff web → docs 002

- From: `apps/web` uploads, push-token and account deletion endpoints
- To: owner of `docs/adr`, `docs/security`
- Status: open

Decisions taken in the implementation that the ADRs and the matrix do not state yet:

1. **Repeated `complete`** (ADR-0030, matrix footnote 31): any state other than `pending`, or a
   presign older than one hour, answers 409 `upload_not_pending` and changes nothing; a second job
   is never enqueued (the row lock serializes concurrent calls; key `upload:<id>`).
2. **Upload quota, second layer**: besides rate-limit group U, presign counts the user's
   `uploads` rows of the last 24 hours under a per-user advisory lock (429 `rate_limited` with
   `Retry-After`). Group U keeps whole sub-window buckets, so after a burst the limiter frees a slot
   up to 1/15 of a day later than the rows do.
3. **Push tokens per user**: at most 10 devices; registering an eleventh removes the least recently
   seen (`MAX_PUSH_TOKENS_PER_USER`, `lib/server/account/push-tokens.ts`). The endpoint still
   answers 204 with no error code, as the registry defines.
4. **Single-use identity tokens for `DELETE me`**: a provider token is accepted once; its keyed hash
   is recorded for 15 minutes in `rate_limit_buckets` (`reauth:<hash>`). The token must name the
   subject linked to the account and have `iat` within 5 minutes (5 s skew). A password proof is
   checked against the caller's own account only.
5. **Audit action names**: `upload.presign`, `upload.complete`, `pushToken.register` (only for a
   new device, a re-bound token or an eviction; never the token value), and
   `account.deletionRequested` (ADR-0032 writes `account.deletion_requested`; the audit writer
   accepts lower-camel segments only). Withdrawals at deletion time write `application.withdrawn`
   with `reason: 'account_deletion'`; a cleared `paid` flag writes `payment.mark` as for any
   drop-out.
6. **Staff deletion** answers 401 `step_up_required` until TOTP enrollment exists (handoff
   `web-to-auth-001`).
