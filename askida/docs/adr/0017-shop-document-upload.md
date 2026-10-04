# ADR-0017: Shop document upload and private storage

- Status: Accepted
- Date: 2026-10-04
- Deciders: Ayberk (owner) delegated engineering decisions inside the specification.

## Context

Specification section 6 item 7 asks for size, count and type limits, a private store, short-lived
signed access and a per-shop quota. Documents (tax certificate, business license) are read only by
moderators. The store is S3-compatible: MinIO locally, a hosted equivalent later (ADR-0002).

## Decision

### Two steps

1. `POST shops/{id}/documents/presign` (owner only). Body: `kind` (`vergi_levhasi|isletme_belgesi`,
   stored as `tax_certificate|business_license`), `mime` (`application/pdf`, `image/jpeg`,
   `image/png`), `size` (1..5 242 880 bytes). Creates a `shop_documents` row with `uploaded_at` null
   (pending) and returns a presigned `PUT` URL valid five minutes for `shops/{shop}/uploads/{doc}`.
2. The client uploads to the URL, then calls `POST shops/{id}/documents/{docId}/confirm` (owner
   only; a document under another shop's path is 404).

### Limits

- At most 3 documents per shop (409 `conflict`). The count includes pending rows whose URL has not
  expired; pending rows older than the URL lifetime plus one minute are deleted (object and row) by
  the next presign, under a lock on the shop row.
- 10 presign calls per shop per day (429 `rate_limited`, `Retry-After`). The limiter
  `document-presign` is applied in the controller after authorization, so a stranger cannot use up a
  shop's quota.

### Confirmation checks

The server reads the stored object back and requires: stored size equal to the declared size and at
most 5 MB (413 `payload_too_large`); content type by `finfo` and leading magic bytes both matching
the declared type (415 `unsupported_media_type`); for PDFs, none of `/JavaScript`, `/JS`, `/Launch`
(also names written with `#xx` escapes or inside Flate streams, inflation capped at 20 MB), no
`/Encrypt`, between 1 and 10 `/Type /Page` entries (422 `validation.failed` with the field
`document` and a code such as `pdf_active_content`, `pdf_encrypted`, `pdf_page_limit`,
`pdf_malformed`, `size_mismatch`, `missing_object`). On any failure the object and the row are
deleted. On success the inspected bytes are written to `shops/{shop}/documents/{doc}` and the upload
key is deleted, so a second `PUT` through the still-valid URL cannot replace checked content.

### Presign cannot bind size or type

A presigned `PUT` does not sign `Content-Length` or `Content-Type`, so the store itself cannot refuse
an oversize or retyped upload; both are enforced at confirmation, and an unconfirmed object is
removed by the next presign. A presigned `POST` policy with `content-length-range` would bind them
at the store and is a candidate hardening step.

### Public storage endpoint

The server reaches the store through `AWS_ENDPOINT`; a device may need another address (emulator,
LAN). When `AWS_PUBLIC_ENDPOINT` is set the upload URL is signed for that host. The host is not
rewritten after signing: the signature covers the `Host` header, and a rewritten URL is refused by
the store (asserted).

### Reading

`DocumentUrlSigner::temporaryUrl(document, actor)` is the only reader: it requires the
`ShopDocumentPolicy::view` rule (panel session with `documents.view`), only for confirmed
documents, issues a five-minute presigned `GET` with `Content-Disposition: attachment` and logs
`document.url_issued` (document id, shop id, causer id). No API role ever receives a document URL.

## Consequences

- Phase 3's panel viewer calls `DocumentUrlSigner` and nothing else.
- Antivirus scanning is not part of this decision; the PDF checks are a sanity filter, and
  documents are opened by moderators only.
- Abandoned uploads are cleaned only on the next presign of the same shop; a scheduled cleanup is a
  suggestion, not built.
- Evidence: `tests/Feature/Documents` and `tests/Feature/Api/Shops` run against a MinIO container.
  Not exercised: a hosted S3-compatible provider (no account, ADR-0006).
