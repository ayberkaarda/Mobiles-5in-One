# ADR-0024: OpenAPI document and contract test

- Status: Accepted
- Date: 2026-10-04
- Deciders: Ayberk (owner) delegated engineering decisions inside the specification.

## Context

The Flutter app (Phase 4) and later web code consume the API. A hand-written document drifts unless
a test ties it to the running application in both directions.

## Decision

- `docs/api/openapi.yaml` is OpenAPI 3.1, hand-written, and describes every `/api/v1` route that
  exists. Each operation names its security (`bearer`), the token abilities in `x-abilities` (an
  empty list means public) and the shop roles in `x-roles`.
- Path parameters: the shop segment is `{shop}` in every path, items `{item}`, documents
  `{document}`. OpenAPI forbids `/shops/{slug}` beside `/shops/{id}`, so `GET shops/{shop}` takes
  the slug and every other operation the UUID. The coverage test compares paths with parameter
  names reduced to `{}`.
- Every response object schema sets `additionalProperties: false`, so a field added to a response
  without a document change fails the test. `Problem` also forbids extras, and the `ProblemCode` enum
  must equal the application enum in order.
- The contract test (`tests/Feature/Api/OpenApiContractTest.php`, validator
  `league/openapi-psr7-validator`, require-dev, PSR-7 messages built with `guzzlehttp/psr7`):
  1. validates the document itself (3.1) and builds both validators;
  2. compares routes and operations in both directions and lists the difference;
  3. runs seeded happy paths and denial classes per endpoint group; each request is validated
     against the document (path, query, security, body) and each response (status must be listed,
     headers, body);
  4. for every operation with a body, the documented example must pass the real form request and
     removing each required field must give 422 naming the field with `required`; a guard fails
     when a body operation has no context;
  5. checks the problem code enum.
- Tokens in the test come from the real login and attest endpoints or the device token issuer;
  Apple and Google tokens are signed at run time. No token-like literal is committed, and the
  document's examples use format-sample tax numbers and IBANs that the test replaces with
  checksum-valid values built at run time.
- Lint runs outside the repository's test suite: a Spectral run with the `spectral:oas` ruleset
  (0 errors, 1 accepted warning: no public contact address exists) and a Redocly lint (valid, 2
  accepted warnings: the local server entry, and a `oneOf` whose branches are exclusive through
  `additionalProperties: false`). No lint ruleset is committed and no CI job runs them yet.

## Consequences

- Some documented errors are not provoked by the test (mostly 401 on routes covered by other
  suites, 413, 500 and 503 on the identity endpoints); they are derived from the error handler's
  mapping, not proven by this test.
- Adding Phase 3 routes (donations, payouts, webhooks) requires document entries first; the
  coverage test fails otherwise.
- Not exercised: client code generation from the document.
