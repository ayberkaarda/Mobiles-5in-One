# ADR-0012: Logging and SQL safety

- Status: Accepted
- Date: 2026-10-04
- Deciders: Ayberk (owner) delegated engineering decisions inside the specification.

## Context

Specification item 14 asks that logs contain no personal data, and item 15 that SQL is always
parameterized, with a static-analysis rule and a grep check.

## Decision

### Log masking

- A log processor masks every record on every channel (stack, single, daily, stderr, syslog,
  errorlog) through a tap. It is idempotent, so a stack and its member channels are safe.
- Values under keys matching `password|passwd|token|secret|code|authorization|cookie|iban|tax` are
  replaced at any depth.
- Text patterns: Authorization, Cookie and Set-Cookie header values; bearer tokens; credential
  `key=value` pairs; e-mail addresses (`a***@d***.tld`); Turkish and generic IBANs; tax and identity
  numbers after keywords (VKN, TCKN, "tax number"); 13 to 19 digit card-like runs; Turkish mobile and
  landline numbers with `+90`, `0090` or `0` prefixes; integers of 10 or more digits.
- Objects that serialise to JSON or arrays are masked recursively; other objects become
  `[object Class]`; exceptions become masked text including the previous chain.
- Over-masking is intentional: any key containing `code` (for example `error_code`) and 10-digit
  numbers starting with 2 to 5 in free text are masked. The processor fails closed.
- Default channel: stack to daily, level info, 30 days of rotation. The local example file uses a
  single file and debug level. Slack and Papertrail channels were removed.

### Request log

One `http.request` line per request: method, route pattern (`unmatched` for 404), status, duration,
request id and user id (only from a guard that already resolved a user, so no extra lookup).
Request bodies, headers and URLs are never logged on any path, so auth, pay and webhook routes never
get their bodies logged.

### SQL

- Application code uses Eloquent or the query builder with bindings. Spatial queries go through
  helpers that use bound `whereRaw` and `selectRaw` only; the point is sent as a bound parameter.
- A PHPStan rule (`askida.rawSqlInterpolation`) flags an interpolated string, heredoc or
  concatenation with a non-literal part as the first argument of: `raw`, `whereRaw`, `orWhereRaw`,
  `selectRaw`, `orderByRaw`, `groupByRaw`, `havingRaw`, `orHavingRaw`, `statement`, `unprepared`,
  `fromRaw`, `joinRaw`. Literals, class constants and nowdocs pass.
- The rule is loaded through a PHP configuration include (`phpstan/rules.php`), so no autoload change
  was needed. Fixtures: a bad file (11 expected rule errors) and a good file (none), run by one test.
- Limits: a string built earlier in a variable is not traced, and matching is by method name. As
  defence in depth, Laravel types these parameters as literal strings, so PHPStan level 8 also reports
  non-literal SQL.

## Consequences

- Debugging with logs is harder where masking is aggressive; request ids and route patterns
  compensate.
- A new raw-SQL helper name outside the list is not covered by the rule until it is added.

## Not exercised / limits

- No error-tracking service is integrated (Sentry is not installed yet), so scrubbing on that side is
  not exercised (ADR-0006, gate G5).
- The log sample for "register, donate and redeem" in the specification needs endpoints that do not
  exist yet; only registration paths and masking unit cases are proven.
- Evidence: `tests/Feature/Security/LoggingTest.php`, `tests/Unit/Support/MaskingProcessorTest.php`,
  `tests/Unit/Phpstan/RawSqlRuleTest.php`, `tests/Feature/Data/GeographyTest.php`.
