# Handoff server-to-android-001: Phase 2 contract

- From: server
- To: android
- Status: open (the Android client was not built against this contract; nothing here was exercised
  from a device, `not exercised: Phase 3`)
- Date: 2026-10-06

## What is needed

Phase 3 builds the sync engine, the ledger screens, photo upload, reminders, statements and the
deletion flow on top of the Phase 2 server. This file is the one place that lists the exact shapes,
so the Android work reads it instead of the server code. The authoritative machine-readable form is
[docs/api/openapi.json](../api/openapi.json); the reasons are in ADR-0013 to ADR-0020.

## Integrity nonce (Phase 1 contract, now fixed)

The Play Integrity request hash for `otp/request` is

`base64url_nopad(SHA-256(UTF-8(phone_e164 + deviceId)))`

with `phone_e164` as sent in the request (`+905...`) and `deviceId` in canonical lowercase UUID
text form, concatenated without a separator. The server computes the same value with
`IntegrityNonce.of` and refuses a verdict bound to anything else
([ADR-0006](../adr/0006-integrity-verifier-and-local-adapters.md)). Verdicts are fakes in this
build (`fake.*` tokens); a real Play Integrity token was never checked.

## Sync ([ADR-0013](../adr/0013-sync-protocol-and-change-log.md))

All writes to customers and entries are outbox operations pushed to
`POST /v1/shops/{shopId}/sync/push`; ids are UUIDv7 made on the device.

```json
{
  "operations": [
    {
      "clientId": "uuid",
      "clientSeq": 1,
      "kind": "CUSTOMER_UPSERT",
      "customer": {
        "id": "uuid",
        "name": "...",
        "phone": "+905...",
        "note": "...",
        "tag": "...",
        "smsConsent": true,
        "smsConsentAt": "2026-10-06T10:00:00Z",
        "smsConsentSource": "IN_PERSON"
      }
    },
    { "clientId": "uuid", "clientSeq": 2, "kind": "CUSTOMER_DELETE", "customerId": "uuid" },
    {
      "clientId": "uuid",
      "clientSeq": 3,
      "kind": "ENTRY_CREATE",
      "entry": {
        "id": "uuid",
        "customerId": "uuid",
        "type": "DEBT",
        "amountMinor": 12500,
        "occurredOn": "2026-10-06",
        "dueOn": "2026-11-06",
        "note": "...",
        "photoKey": "media/<shopId>/<mediaId>.jpg",
        "reverses": "uuid"
      }
    }
  ]
}
```

- At most 500 operations. `clientSeq` is at least 1 and strictly increasing in array order and per
  device. `clientId` is the idempotency key and must be unique inside the batch.
- Field rules: customer `name` 1 to 80, `phone` Turkish mobile E.164 only, `note` at most 500, `tag`
  1 to 30, consent needs `smsConsentAt` and `smsConsentSource` (`IN_PERSON`, `PHONE`, `WRITTEN`,
  `OTHER`); entry `type` `DEBT` or `PAYMENT`, `amountMinor` 1 to 10 000 000 000 (kuruş), `occurredOn`
  at most one day after today in Istanbul, `dueOn` only on a `DEBT`, `photoKey` only of the path
  shop. A reversing entry has the same `type` and `amountMinor` as the original, `reverses` set, and
  no `dueOn` and no `photoKey`.
- Response 200: `{"results": [{"clientId", "status", "entityId"?, "code"?, "errors"?}], "head": n}`.
  `status` is `APPLIED`, `DUPLICATE` (already applied: treat as success) or `REJECTED` with a `code`
  (`forbidden`, `not_found`, `conflict`, `validation.failed` with `errors: [{field, code}]`,
  `customer.deleted`, `ledger.already_reversed`, `ledger.reversal_mismatch`, `plan.customer_limit`).
  A rejected operation never stops the rest of the batch; a rejected operation leaves no receipt, so
  the same `clientId` may be sent again once the cause is fixed.
- A whole-batch `422 validation.failed` means the batch shape is wrong (over 500, `clientSeq` not
  increasing as `out_of_order`, duplicate `clientId`, unknown `kind`, a required property missing
  inside an operation). Nothing was applied; this is a client bug, do not retry blindly.
- A `500` in the middle of a batch may follow committed operations: send the same batch again with
  the same `clientId` values and read `DUPLICATE` for those that applied.
- Pull: `GET /v1/shops/{shopId}/sync/pull?since={seq}&limit={1..500}` gives
  `{"changes": [{seq, entity, entityId, op, at, payload}], "nextSince", "hasMore"}` ordered by
  `seq`. `entity` is `CUSTOMER` or `ENTRY`, `op` is `UPSERT` or `DELETE`, and `payload` is the full
  snapshot: customer `{id, name, phone, note, tag, smsConsent, smsConsentAt, smsConsentSource,
createdAt, updatedAt, deletedAt}`, entry `{id, customerId, type, amountMinor, currency, occurredOn,
dueOn, note, photoKey, reverses, reversedBy, createdBy, createdAt}`. Apply rows in `seq` order and
  store `nextSince` only after the page is applied; `seq` can have gaps; a `since` beyond the head
  returns an empty list.
- Balance: sum over entries with `reverses` and `reversedBy` both null of `+amountMinor` for `DEBT`
  and `-amountMinor` for `PAYMENT` ([ADR-0014](../adr/0014-ledger-model.md)); show a reversed entry
  struck through with its reversal line. Customers are last-writer-wins by server time; a deleted
  customer rejects further upserts and entries (`customer.deleted`).
- Limits: push 60 per minute, pull 120 per minute per user (`429` with `Retry-After`); Free plan
  100 live customers.

## Photos ([ADR-0017](../adr/0017-media-pipeline.md))

1. `POST /v1/shops/{shopId}/media/presign` with `{"contentType": "image/jpeg" | "image/webp",
"contentLength": 1..1200000}` gives 201
   `{"mediaId", "uploadUrl", "method": "PUT", "headers": {"Content-Type", "Content-Length"}, "expiresAt", "photoKey"}`.
   Compress on the device so the file is at most 1 200 000 bytes (longest side up to 1600 is enough).
2. `PUT` the bytes to `uploadUrl` with exactly the returned `headers` (they are part of the
   signature; another length is refused by storage). The URL is valid 10 minutes.
3. `POST /v1/shops/{shopId}/media/{mediaId}/complete` (no body) processes the image and answers
   `{"mediaId", "photoKey", "status": "READY", "width", "height", "bytes"}`. A second call is
   idempotent. Errors: `409 media.not_uploaded`, `413 media.too_large`, `422 media.invalid`.
4. Use `photoKey` in the entry. It may be stored before completion (the presign response already
   carries it), but the photo is only viewable after `READY`.
5. `GET /v1/shops/{shopId}/media/{mediaId}` returns `{"mediaId", "status", "photoKey", "downloadUrl", "expiresAt"}`
   for a `READY` object (`409 media.not_ready` otherwise); the URL is valid 10 minutes, do not cache
   it. Quota: `409 plan.photo_limit` (Free 200 a month).

## Statements and reminders ([ADR-0015](../adr/0015-statement-links-and-public-page.md), [ADR-0016](../adr/0016-sms-reminders-and-netgsm-client.md))

- `POST /v1/shops/{shopId}/statement-links` with `{"customerId"}` gives 201
  `{"linkId", "url", "token", "expiresAt"}` (30 days, at most 20 open links per customer: `409 statement.link_limit`). Share `url` (WhatsApp
  intent); the token is returned once.
- `GET /v1/shops/{shopId}/customers/{customerId}/statement.pdf` returns the PDF as an attachment.
- `POST /v1/shops/{shopId}/reminders` with `{"customerId", "channel": "SMS", "template": "BALANCE"}`
  gives 201 `{"reminderId", "status": "SENT", "sentAt", "providerMessageId"?, "quota": {"month", "used", "limit"}}`.
  Errors: `409 sms.phone_missing`, `409 sms.consent_missing`, `409 reminder.no_balance`,
  `429 sms.quota_exceeded` and `429 sms.daily_cap_reached` (with `Retry-After`), `502 sms.provider_failed`
  (the SMS may or may not have been sent: do not retry automatically). `WHATSAPP` and `DUE_TODAY`
  are not accepted by the server.

## Re-authentication and deletion ([ADR-0018](../adr/0018-account-and-shop-deletion.md), [ADR-0019](../adr/0019-ownership-transfer-and-reauthentication.md))

- `POST /v1/auth/reauth/request` (bearer, no integrity token, no body) sends a code to the user's
  own phone, 202. The code is single use, valid 5 minutes, 5 attempts, and is not interchangeable
  with a sign-in code. A wrong or used code is `403 auth.reauth_invalid` (not 401: do not sign the
  user out). Limits: 3 requests and 10 verifications per 10 minutes.
- `DELETE /v1/me` with `{"code", "deleteOwnedShops": false}` starts a 14 day grace and answers 202
  `{"requestedAt", "graceUntil", "shopsToDelete": [uuid]}`. `409 account.owner_of_shared_shop` means
  the user owns a shop with other members: transfer ownership, or send `deleteOwnedShops: true`.
  `409 account.deletion_pending` means a request is already open. `GET /v1/me` carries
  `"deletion": {"requestedAt", "graceUntil", "blocked"} | null`; show a banner with a cancel action
  and the explanation when `blocked` is true (a member joined during the grace).
  `DELETE /v1/me/deletion` cancels (204, 404 when none is open). The account keeps working during
  the grace; after completion every token is refused (401) and the device must wipe local data.
- `DELETE /v1/shops/{shopId}` with `{"code"}` (owner only) schedules one shop the same way, 202
  `{"requestedAt", "graceUntil"}` (`409 shop.deletion_pending`); `DELETE /v1/shops/{shopId}/deletion`
  cancels it.
- `POST /v1/shops/{shopId}/ownership-transfer` with `{"userId", "code"}` (owner only, the target is
  an active `STAFF` member) answers 200 `{"shopId", "ownerUserId", "previousOwnerUserId"}`; the
  caller becomes `STAFF`. Every destructive call needs its own fresh code.

## Session lifetime ([ADR-0020](../adr/0020-refresh-family-lifetime-and-auth-retention.md))

A refresh family ends 180 days after sign-in. A refresh after that is `401 auth.refresh_invalid`
(the same answer as an unknown token); the app goes to sign-in. Sliding refresh stays 60 days
inside it.

## Requested outcome

The Android owner builds the client against this file and the OpenAPI document, and records in the
status line when each part is done or if a shape needs to change (a change goes back to the server
owner through a new handoff). Not exercised from a device: all of the above.
