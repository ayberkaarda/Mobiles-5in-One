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

## Phase 4 entries written ahead of the code

The Phase 4 operations were added to `openapi.json` from the contract, before the server code
exists, so the parallel billing, webhook and Android work share one target. This is the one
exception to the export-only rule, and it was made in the canonical format (sorted keys, 2-space
indent, `" : "` separators, trailing newline) so the later export can replace it line for line:

| Operation                              | `operationId`     | Tag (controller class)            | Contract                                                             |
| -------------------------------------- | ----------------- | --------------------------------- | -------------------------------------------------------------------- |
| `GET /v1/shops/{shopId}/billing`       | `billingState`    | `billing-controller`              | [ADR-0031](../adr/0031-billing-purchase-linking-and-entitlements.md) |
| `POST /v1/shops/{shopId}/billing/link` | `linkPurchase`    | `billing-controller`              | [ADR-0031](../adr/0031-billing-purchase-linking-and-entitlements.md) |
| `POST /v1/webhooks/play-rtdn`          | `receivePlayRtdn` | `play-rtdn-webhook-controller`    | [ADR-0032](../adr/0032-webhook-authentication.md)                    |
| `POST /v1/webhooks/sms-dlr`            | `receiveSmsDlr`   | `sms-delivery-webhook-controller` | [ADR-0032](../adr/0032-webhook-authentication.md)                    |

New schemas: `LinkPurchaseRequest`, `BillingState`, `PlanLimitsView`, `PlanUsageView` and
`SubscriptionView`. The method names, class names and DTO names in the table and in
[handoff 002](../handoffs/server-to-android-002-phase4-contract.md) are binding, because springdoc
derives `operationId`, tags and schema names from them. The webhook controllers take only
`HttpServletRequest`, so the document shows no request body or header for them; their wire format
is in ADR-0032. After the Phase 4 merge the lead refreshes the file from `OpenApiSnapshotTest` as
described above, and `openApiContractCheck` then compares the live document with it.

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
