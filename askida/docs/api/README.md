# API documentation

The HTTP contract of the server (`/api/v1`, JSON, RFC 9457 problem details) is described by a
hand-maintained OpenAPI 3.1 file, `openapi.yaml`. The contract test
(`server/tests/Feature/Api/OpenApiContractTest.php`) checks that it documents exactly the registered
routes and that real responses match it.

## Push data

Push messages are not HTTP bodies, so they appear only as component schemas (`PushData`,
`PushDataHooksIssued`, `PushDataHookRedeemed`). Every value is a string and `type` selects the screen:

| `type`          | Recipient                   | Keys                                             | Opens                      |
| --------------- | --------------------------- | ------------------------------------------------ | -------------------------- |
| `hooks.issued`  | owner and staff of the shop | `type`, `shop_id`, `item`, `count`               | redemptions of `shop_id`   |
| `hook.redeemed` | the donor                   | `type`, `donation_id`, `shop_id`, `item`, `shop` | the donation `donation_id` |

No push carries recipient data (anon id, device, code, hook id or time); the contract test validates
the messages the server builds against these schemas.

## Security notes (Phase 6)

- Path ids are UUIDs and are accepted in any letter case. Every rate limiter that keys on a path id
  (`redeem` per shop, `document-presign` per shop) builds its key from the lower-cased id, so a
  different spelling of the same id shares one bucket (`docs/security/attack-report.md`, F1 and F2).
- Push titles and bodies carry stored shop and item names verbatim as plain text. A client must
  display them as text and never interpret them as HTML (ADR-0054).
- `openapi.yaml` is the input of the OWASP ZAP API scan (`server/.zap/api-scan.conf`,
  `docs/security/zap-report.md`, ADR-0055); a new operation is scanned once it is documented there.
