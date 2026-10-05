# API documentation

The HTTP contract of the server (`/v1`, JSON, RFC 9457 Problem Details) is described by an OpenAPI
document, `openapi.json`, exported from the server with springdoc-openapi (API only, no UI). The
Android app reads it; it changes only through the handoff route in
[docs/handoffs](../handoffs/README.md). The endpoint list and the role required by each endpoint
are in [the authorization matrix](../security/authorization-matrix.md); the error codes are in
[ADR-0008](../adr/0008-problem-details-and-error-codes.md).

## Export

`OpenApiSnapshotTest` fetches `/v3/api-docs` through MockMvc in profile `test` (the document is
served only in `local` and `test`) and writes it to `server/build/openapi/openapi.json` on every
test run. To refresh the committed copy:

```sh
cd cetele/server
./gradlew test --tests 'app.cetele.server.web.OpenApiSnapshotTest'
cp build/openapi/openapi.json ../docs/api/openapi.json
```

The copy is a manual step that the lead performs after merging; nobody edits `openapi.json` by
hand. The document lists the Phase 1 operations (authentication, `me`, shops, invitations and
members), the bearer scheme and the fixed server entry `https://cetele.app`. The authenticated
principal does not appear as a parameter.

A test that compares the committed file with the live document, and the contract test against real
responses, arrive in Phase 2 together with the domain endpoints. Until then nothing fails when the
two differ, so the copy is refreshed at every phase gate.
