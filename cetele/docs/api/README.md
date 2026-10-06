# API documentation

The HTTP contract of the server (`/v1`, JSON, RFC 9457 Problem Details) is described by an OpenAPI
document, `openapi.json`, exported from the server with springdoc-openapi (API only, no UI). The
Android app reads it; it changes only through the handoff route in
[docs/handoffs](../handoffs/README.md). The endpoint list and the role required by each endpoint
are in [the authorization matrix](../security/authorization-matrix.md); the error codes are in
[ADR-0008](../adr/0008-problem-details-and-error-codes.md).

## Export

`OpenApiSnapshotTest` fetches `/v3/api-docs` through MockMvc in profile `test` (the document is
served only in `local` and `test`) and writes a canonical form to `server/build/openapi/openapi.json`
on every test run: map keys sorted, 2-space indent, trailing newline. To refresh the committed copy:

```sh
cd cetele/server
./gradlew test --tests 'app.cetele.server.web.OpenApiSnapshotTest'
cp build/openapi/openapi.json ../docs/api/openapi.json
```

The copy is a manual step that the lead performs after merging; nobody edits `openapi.json` by
hand. The document lists the operations of Phase 1 (authentication, `me`, shops, invitations and
members) and Phase 2 (sync push and pull, statement links and the PDF statement, reminders, media
presign, complete and download, re-authentication, account and shop deletion with cancellation, and
ownership transfer), the bearer scheme and the fixed server entry `https://cetele.app`. The public
statement page `GET /s/{token}` is HTML, not part of the `/v1` document. The authenticated
principal does not appear as a parameter.

## Contract check

```sh
cd cetele/server
./gradlew check openApiContractCheck
```

`openApiContractCheck` (verification group) runs the tests, then compares
`build/openapi/openapi.json` with `docs/api/openapi.json` byte for byte after line-ending
normalisation and fails with the first differing line number and both lines. `check` does not
depend on it, because the tree of a worker carries a stale copy by design until the lead refreshes
it; the lead runs both after refreshing the copy, and the `cetele` CI server job runs the same
command, so a change to an endpoint without a refreshed `openapi.json` fails the build. The check
proves that the committed document equals the live one; the contract test against real responses
(for example a schema validator over recorded bodies) is not built (`not exercised`).
