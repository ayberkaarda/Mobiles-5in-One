# ADR-0049: Mobile auth flows: screens, email links and provider sign-in

- Status: Accepted
- Date: 2026-10-02
- Deciders: Engineering (product spec §0.7), reported to Ayberk (owner)
- Related: product spec §4 (auth), §6 items 5, 11, 13; ADR-0014, ADR-0015, ADR-0019, ADR-0027,
  ADR-0040, ADR-0047, ADR-0048; threat model T-AUTH-06, T-AUTH-08, T-MOB-01

## Context

The foundation (ADR-0047) provides the API client, the session (secure refresh token, in-memory
access token, single-flight refresh) and the route guard. Users still need ways in: sign-in,
registration, password reset, email verification, and the Apple and Google sign-in the product
spec lists. The API contract is fixed: registration and "forgot password" always answer 202 and
issue no session (ADR-0015), verification and reset tokens arrive in email links as a URL fragment
(ADR-0040), and Apple and Google identity tokens are nonce-bound (the server compares the raw
nonce for Apple with the SHA-256 claim of the token).

## Decision

### Routes

- Signed-out side of the root stack: `index` (welcome) and the `(auth)` group with
  `giris` (sign-in), `kayit` (registration) and `sifremi-unuttum` (forgot password). They sit in
  the same guard as the welcome screen, so a signed-in user is never shown them.
- `e-posta-dogrula` and `sifre-sifirla` sit outside both guards. The same link must work for a
  user who is signed in (verifying the address of a running session) and for one who is not.
- Slugs are Turkish and match the web paths of ADR-0027 / ADR-0040, so a universal link and an
  in-app route name the same thing.

### Sessions and forms

- Sign-in calls `POST auth/login` and hands the token pair to `session.establish`. The guard then
  opens the tabs by itself; screens do not navigate after a successful sign-in. A success response
  without a usable token pair is an `invalid_response` and never a half-started session.
- Registration shows "check your email" and a button to sign-in; it never claims that the account
  was created or that the address is free (ADR-0015). Forgot password shows the same text for
  every address.
- Forms use react-hook-form with small check functions that mirror the contract schemas (limits,
  trimming, email rule). `zod` and `@kadro/contracts` are not dependencies of the app yet, so the
  schemas cannot be imported; tests compare every rule with the schemas by path, so the two cannot
  drift unnoticed. Sign-in checks only presence and the upper bound of the password, so the form
  does not reveal the length rule that the server hides behind `invalid_credentials`.
- One action runs per form at a time (a second press or keyboard submit is ignored), inputs are
  disabled and the button is marked busy meanwhile, and nothing is set after the screen is gone.
- Field problems are worded in the `auth` namespace (`validation.*`). Every failure that comes from
  the API is worded by `errorMessage()` from the `errors` catalog (ADR-0048); the screens add no key
  to that catalog and show server `title` / `detail` never. The request id is shown as a small
  reference line.

### Email links

- The token is read from the URL fragment of the link that opened the screen (and from a route
  parameter or query value for the `kadro://` scheme), only when the link's path matches the screen.
  It is held in memory, never written to storage, and never logged.
- A missing or malformed token shows the "link invalid" state without calling the API.
- Verification posts once per mounted flow; a rejected token (`token_invalid`) is final, the single
  use is enforced by the server. A newer link opened while the screen is up replaces the held token
  and restarts the flow.
- A successful reset signs this device out locally when a session exists, because the server has
  revoked every session of the account; the screen then points to sign-in. A successful
  verification refreshes the cached profile.

### Apple and Google

- The flow around the platform sheets is ordinary code behind two ports (`AppleAuthPort`,
  `GoogleAuthPort`): create a raw nonce (256 bits of secure randomness), hand the sheet what it
  needs, post the identity token with the nonce, establish the session. A dismissed sheet is a
  cancellation, not an error. Apple's name is sent only when it passes the display-name rule.
- Apple gets `SHA-256(raw nonce)` as hex; the API gets the raw nonce. SHA-256 is implemented in the
  app (no crypto module is a dependency) and checked against Node's digest in tests.
- Without a secure random source no nonce is made and neither provider is offered: there is no
  fallback to `Math.random`. The runtime source is the Web Crypto global when it exists.
- Google is not wired: the OAuth client ids are not part of the validated app configuration, and
  there is no Google account to test with. The port reports itself unavailable and the button is
  not shown.
- Evidence limit: the provider flows are covered with made-up tokens, test doubles for the sheets
  and a mock API. No real Apple or Google account, token or signature check was involved, and the
  native sheets were not run on a device or simulator. This is not proof that sign-in works end to
  end; that needs a real device and real accounts.

## Consequences

- The auth screens work with the dependencies the app already has; the gaps (secure random and
  digest from a crypto module, Google client ids, contracts and zod for form schemas) are listed as
  needs and are small changes behind the existing ports and check functions.
- There is no resend for a verification email: the API offers none, and registering again sends an
  "already registered" mail. A resend endpoint is a contract request.
- The Apple button is the shared button of the UI kit. Before store submission it has to be checked
  against Apple's button guidelines or replaced by the system button.
- Router behavior (a deep link into a closed route while signed out, the link opening
  `sifre-sifirla` through the operating system) is not covered by unit tests; that is device and
  Maestro work.
