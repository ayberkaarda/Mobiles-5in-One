# ADR-0074: Error-event scrubbing ahead of error monitoring

- Status: Accepted (scrubber only; error monitoring itself is not integrated)
- Date: 2026-10-03
- Deciders: Engineering, reported to Ayberk (owner)
- Related: product spec §6 item 14; ADR-0002; `apps/web/lib/server/logging.ts`;
  `packages/config/src/scrub.ts`, `packages/config/src/scrub.test.ts`;
  `docs/security/verification-matrix.md` row 14

## Context

Spec item 14 asks for clean logs: `pino` redaction on the server (done, `apps/web/lib/server/logging.ts`)
and a Sentry `beforeSend` hook that scrubs the same fields on web and mobile. This number was
reserved for the error-monitoring decision. There is no Sentry account or DSN for this project, no
`@sentry/*` dependency in any package, and adding one without a project to send to would ship SDK
code that cannot be exercised end to end.

The scrubbing rules, however, do not depend on the SDK: an error event is a plain JSON object
(`request`, `user`, `message`, `logentry`, `exception`, `extra`, `tags`, `contexts`,
`breadcrumbs`). They can be written and tested now so that the integration later is one line.

## Decision

1. **Location.** `scrubEvent(event)` lives in `@kadro/config`, exported as `@kadro/config/scrub`.
   It is the only workspace package that both `apps/web` and `apps/mobile` already depend on. The
   subpath has `import` and `require` conditions like `./mobile`, so Metro and Next.js both resolve
   it. The module is pure, dependency-free and does not read the environment.
2. **Rules.** The function returns a scrubbed copy and never mutates its input:
   - removes `request.cookies`, `request.data` (the body) and `user.ip_address`;
   - replaces values under credential keys with `[Redacted]` at any depth, case and separator
     insensitive: `authorization`, `proxy-authorization`, `cookie(s)`, `set-cookie`, `x-csrf-token`,
     API keys, passwords, tokens (access, refresh, id, identity, session, CSRF), `totp`, `code`,
     secrets and `body` fields; header and query `[name, value]` pair arrays are handled too;
   - redacts credential query parameters (`token`, `code`, `access_token`, `key`, `signature`,
     `invite`, ...) in URLs and in `request.query_string` (string, object or pairs);
   - masks email addresses to `a***@d***` in every string (the server log format);
   - in free-text fields (message, log entry, exception values, extra, tags, breadcrumbs, request)
     also redacts bearer values, JWTs and runs of 32 or more key-shaped characters that mix
     letters and digits;
   - keeps identifier fields (`event_id`, `release`, `environment`, `sdk`, ...) verbatim and gives
     `contexts` (trace ids) only key redaction and email masking;
   - cuts cycles and nesting deeper than 12 levels to `[Truncated]`.
3. **Integration, when an account exists.** Pass `scrubEvent` as `beforeSend` (and scrub
   breadcrumbs in `beforeBreadcrumb`) in `apps/web` (client, server and edge configs) and
   `apps/mobile`, with `sendDefaultPii: false`. That change, its DSN in `packages/config` and a test
   that captures a real SDK event through the hook are a separate task.

## Consequences

- The scrubber is built and tested: `packages/config/src/scrub.test.ts` (14 cases, including
  nested objects, arrays, header pairs, every query-string form, breadcrumbs in both shapes,
  cycles and immutability). Test secrets are assembled at run time.
- Error monitoring is **not** integrated: no SDK, no DSN, no event has been sent anywhere. The
  verification matrix row 14 therefore stays `partial`; its open proof is "a Sentry event from the
  login flow, captured after `beforeSend`, contains no email, password or token".
- The rules mirror the server log redaction by hand; a change to one list should be reflected in
  the other until both read from a shared list.
- Over-redaction is accepted: a 32-character hexadecimal request id inside a breadcrumb message is
  redacted along with real tokens.

## Alternatives considered

- **Add `@sentry/nextjs` and `@sentry/react-native` now, without a DSN.** Ships untested SDK code
  and native build changes for no observable benefit; rejected until an account exists.
- **A new shared package for the scrubber.** One more build target for a single file; rejected
  while `@kadro/config` is already the shared dependency of both apps.
- **Rely on the SDK's server-side scrubbing.** Data would leave the device before it is scrubbed,
  which the spec rules out.
