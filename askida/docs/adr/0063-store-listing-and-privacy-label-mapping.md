# ADR-0063: Store listing and privacy label mapping

- Status: Accepted
- Date: 2026-10-05
- Deciders: Ayberk (owner) delegated engineering decisions inside the specification.

## Context

The specification's ASO paragraph (section 7) fixes the title, subtitle, keywords and six Turkish
screenshot captions, and says Play Data Safety and App Privacy "must state that anonymous mode
collects no personal data". In anonymous mode the server does process data that the store forms
ask about. No store account exists, so nothing is submitted (ADR-0006).

## Decision

- `docs/seo/aso.md` holds the ASO facts; `docs/release/store-listing.tr.md` and
  `store-listing.en.md` hold the short and full descriptions within the store limits (measured:
  title 29/30, Play short 79 and 80/80, full descriptions about 2 200/4 000) and the what's-new text;
  no recipient imagery.
- `docs/release/screenshots/`: six raw emulator captures (1080x2400, light scheme, sample data
  labelled `[ÖRNEK]`, no device frame) with their captions; iOS screenshots do not exist.
- **Deviation from the specification's wording.** The sentence "anonymous mode collects no
  personal data" is not used; honesty wins over the specification. The listing says what is
  processed: no account, name, e-mail address, phone number, precise location or rating; an
  approximate location (two decimals) sent with the nearby-shops request and not stored; a random
  `anon_id` and the integrity verdict, kept to enforce limits and deletable from the app.
- `docs/release/privacy-labels.md` maps every data element to the Play Data Safety and App Privacy
  answer with an Evidence column (code path or test). Two corrections to the Phase 6 plan text are
  recorded there: `anon_id` is created by the **server** (`Str::uuid7()` in
  `AnonAttestationService`), not by the app (the app only creates the 32-byte `device_nonce`, of
  which the server keeps a keyed hash as a cache key, never in the database); donors and merchants
  may send a precise position in the `near` query, recipients a two-decimal one, none stored.
- Push token in anonymous mode: not collected (account-only route group; the app registers a token
  only for a signed-in user).

## Consequences

- The privacy-label IP and location rows were written before the nginx access log change of
  ADR-0055 and still describe the earlier default log format (client address and request line).
  Since that change the application nginx logs neither the address nor the query string; the two
  rows and the matching sentence in `docs/ops/deploy.md` need a refresh. IP addresses remain in
  transit, in the edge proxy log of a deployment, in nginx error-log lines on failures, and in the
  `hooks-reserve:ip:<ip>` rate-limiter key in Redis.
- Store limits are measured by script; the texts are samples until a store account exists.
- not exercised: store accounts, submission, the Data Safety and App Privacy forms, iOS
  screenshots, real attestation, push, payment and mail providers.
