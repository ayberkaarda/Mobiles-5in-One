# ADR-0048: Mobile translations and error copy

- Status: Accepted
- Date: 2026-10-02
- Deciders: Engineering (product spec §0.7), reported to Ayberk (owner)
- Related: product spec §2 (tone of voice), §6 item 13, §8 (i18n); ADR-0013, ADR-0047

## Context

Spec §8 fixes i18next with the namespaces `common, auth, teams, matches, opencalls, venues,
errors`, Turkish first and English second. Spec §6 item 13 requires the app to map the problem
`code` of an API error to Turkish copy in `i18n/tr/errors.json`. The API never sends user-facing
prose that depends on internal state; its `title` is a fixed English string per code. Namespace
files are written by different work packages, so the app must build and run while some of them
do not exist yet.

## Decision

- Files: `apps/mobile/src/i18n/<language>/<namespace>.json` for `tr` and `en`. Metro collects them
  with `require.context` at build time; a namespace without a file is registered empty for both
  languages, so the build and every lookup keep working, and a file added later is picked up
  without a code change.
- All namespaces are bundled and initialized synchronously (`initAsync: false`): the first frame
  already has its copy; there is no network loading of translations.
- Language: the first device language (`expo-localization`) that is Turkish or English, Turkish
  otherwise. Fallback language Turkish; fallback namespace `common`.
- Interpolation does not escape (React escapes rendered text). Copy avoids plural suffixes and
  passes numbers as `{{number}}`, so it does not depend on `Intl.PluralRules`.
- Error copy: `errorMessage(i18n, error)` returns `errors:<code>` when that key exists; network
  failures and timeouts have their own copy in `common:error.*`; any other failure (unknown code,
  a non-problem body, a render error) gets `common:error.unknown`. Server `title` and `detail` are
  never displayed. Error screens show the `requestId` as a selectable reference so support can
  find the request in the logs.
- `errors.json` holds exactly one non-empty message per entry of `ERROR_CODES` in
  `@kadro/contracts` plus the six client-side keys of `CLIENT_ERROR_KEYS` (`network_error`,
  `offline`, `server_error`, `session_expired`, `timeout`, `unknown`), nothing else; Turkish and
  English have the same keys and the same `{{placeholders}}` (`rate_limited` uses `{{seconds}}`,
  filled from `Retry-After`). `errorMessage` produces every client-side key except `offline`,
  which is used once the app can detect connectivity (a network-state dependency); until then an
  unreachable server is reported as `network_error`. A test enforces this for each language whenever the file
  exists. A missing file is never counted as passing: by default the test is reported as skipped,
  and with `KADRO_REQUIRE_ERROR_CATALOG=1` it fails. Once the catalogs are merged, requiring them
  becomes the default (the switch is inverted and CI sets nothing); until then a delivery check
  runs the mobile tests with the switch set. The turbo `test` task forwards only listed variables,
  so the switch takes effect with `pnpm --filter @kadro/mobile test` until it is added to the
  task's `passThroughEnv`.
- Copy follows the brand voice (§2): short, friendly "sen" form in Turkish.

## Consequences

- A new error code in the contracts fails the mobile test until both catalogs have copy for it.
- Feature work packages add their namespace files without touching the i18n setup.
- Copy for the tab lists lives in `common` until the feature namespaces take it over.
