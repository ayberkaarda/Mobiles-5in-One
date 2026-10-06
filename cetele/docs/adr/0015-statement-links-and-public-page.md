# ADR-0015: Statement links and the public statement page

- Status: Accepted
- Date: 2026-10-06
- Deciders: Ayberk (owner)

## Context

A shop shares a customer's statement by WhatsApp or SMS (spec section 3, story 6). The customer is
not a user, so the only credential is the link itself, and a link is a bearer token for one
customer's ledger (asset A6 of the [threat model](../security/threat-model.md)). The page must not
be indexed or cached, must not execute anything a stored name could inject, and must look the same
for every unusable link. The app also needs a server-rendered PDF for the case where the on-device
renderer is not enough (spec section 5).

## Decision

### Token and storage

- 32 random bytes from `SecureRandom`, base64url without padding (43 characters). The server stores
  only the lower-case hex SHA-256 in `statement_links.token_hash` (unique, with a format
  constraint). The token is returned once by the endpoint that creates the link and never logged.
  - `V5ServicesSchemaTest`: `statement link hash lifetime and open count are constrained`
  - `StatementLinkServiceTest`: `link token is returned once and only its hash is stored`
  - `StatementLinkEndpointTest`: `link returns a capability and stores only its hash`
- A lookup by hash is a capability lookup like the invitation codes of
  [ADR-0007](0007-tenancy-and-permission-enforcement.md): `StatementLinkIndex` resolves the shop of
  a hash and the tenant repository does the rest.
- Lifetime 30 days (`expires_at`). `opened_at` and `open_count` are updated on every successful open
  in a transaction of their own, so a rendering failure cannot lose the count
  (`StatementPageTest`: `page shows rows and balance and records every opening`).
- At most 20 open links (not revoked, not expired) per customer, enforced under the shop row lock
  (`statement.link_limit`, 409):
  - `StatementLinkServiceTest`: `twenty open links are allowed and expired or revoked links free a slot`
  - `StatementLinkServiceTest`: `concurrent issuance never exceeds twenty open links and opens are not lost`
  - `StatementLinkEndpointTest`: `twenty first active link is rejected and foreign customers stay hidden`
- Deleting a customer revokes the customer's links (`revokeForCustomer`, scoped by shop and
  customer; `StatementLinkServiceTest`:
  `opening tracks time and count and revocation is scoped by customer and shop`). Retention removes
  links expired or revoked more than 90 days ago ([ADR-0018](0018-account-and-shop-deletion.md)).

### Endpoints

- `POST /v1/shops/{shopId}/statement-links` (`STATEMENT_LINK_CREATE`, body `{customerId}`) answers
  201 `{linkId, url, token, expiresAt}`. A customer that is deleted or belongs to another shop is 404. Bucket `statement.link.user`, 30 per 10 minutes. Decision D-3 of the
  [authorization matrix](../security/authorization-matrix.md) is settled here: `STAFF` may create
  links, because the WhatsApp reminder in story 6 needs one and a `STAFF` member already reads the
  whole ledger.
- `GET /s/{token}` is public (`permitAll()`, the same rule 4 treatment as health). The token must
  match `^[A-Za-z0-9_-]{43}$`. A malformed, unknown, expired or revoked token, a deleted customer
  and a deleted shop all answer the same HTML 404 page, in Turkish, with no detail. The bucket
  `statement.page.ip` allows 60 requests per minute per client address; the 61st is 429.
  - `StatementPageTest`: `all unusable links share one error page`
  - `StatementPageTest`: `deleted shop cannot expose its statement`
  - `StatementPageTest`: `sixty first request from an address is limited`
- `GET /v1/shops/{shopId}/customers/{customerId}/statement.pdf` needs `LEDGER_READ` and
  `CUSTOMER_READ` (both roles) and answers `application/pdf` as an attachment named
  `hesap-dokumu.pdf` (with the UTF-8 `filename*` form). Bucket `statement.pdf.user`, 20 per 10
  minutes.

### Page content and headers

- The page shows the shop name, the customer name, the preparation date, the rows (date,
  description, debt, payment, running balance) ordered by `occurred_on, created_at`, reversed
  entries struck through with their reversal line, and the current balance. One class,
  `StatementAssembler`, builds the data for page and PDF, so both show the same rows
  (`StatementPageTest`: `reversed entries stay visible without changing the running balance`).
- The response carries `Cache-Control: no-store`, `Pragma: no-cache`,
  `X-Robots-Tag: noindex, nofollow` and a `robots` meta tag. The global header chain
  ([ADR-0010](0010-security-headers-csp-and-https.md)) adds the CSP with the per-request nonce,
  `Referrer-Policy` and the other fixed headers. There is no inline script and no inline style; the
  one stylesheet (`/assets/statement.css`) and the fonts (Inter and Manrope, with the SIL OFL text
  shipped next to them) are served from `/assets/**`, which is public.
- All dynamic text goes through `th:text`. `TemplateScanTest` fails on `th:utext`,
  `th:inline="javascript"`, inline `<script>` and `style=` in any template. `StatementXssTest`
  (`html escapes stored text while pdf preserves literal text`) renders a customer name
  `<script>alert(1)</script>` and a shop name with quotes and ampersands and checks that the HTML is
  escaped while the PDF text contains the literal characters.
- Logs carry the route pattern and ids, never the token or a name (`StatementLogSampleTest`).

### PDF

PDFBox 3.0.8 with the Inter and Manrope fonts embedded (`PDType0Font`), A4, multi-page, the same
rows and totals as the page (`StatementPdfTest`:
`pdf embeds fonts and paginates all rows with totals`).

## Consequences

- A link forwarded by the customer is readable by whoever holds it until it expires or is revoked.
  That is inherent to a bearer link and is recorded as residual risk in threat model 4.8.
- The 20-link cap and the 30-day lifetime bound the number of live credentials per customer.
- A shop that deletes a customer ends every link to that customer at once.
- The page has been rendered only through MockMvc; no browser rendering and no real WhatsApp
  preview were exercised (`not exercised: no browser run and no WhatsApp client`, ADR-0004 G12).
- Evidence: `StatementPageTest`, `StatementXssTest`, `StatementPdfTest`, `StatementLinkEndpointTest`,
  `StatementLinkServiceTest`, `StatementPermissionTest`, `StatementLogSampleTest`,
  `TemplateScanTest`, `V5ServicesSchemaTest`.
