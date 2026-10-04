# ADR-0023: Route classification and authorization completeness

- Status: Accepted
- Date: 2026-10-04
- Deciders: Ayberk (owner) delegated engineering decisions inside the specification.

## Context

ADR-0013 defined the policy layer and the matrix suite and left rows for missing endpoints as
`PENDING`. Phase 2 adds the endpoints, so every row that now has a route must be proven against the
route table, and a new route must not be able to ship unclassified.

## Decision

### Classification table

`tests/Datasets/RouteClassification.php` assigns every `api/v1` route one class:

| Class      | Meaning                                  | Abilities                   | Shop rule                        |
| ---------- | ---------------------------------------- | --------------------------- | -------------------------------- |
| `public`   | no authentication, no ability middleware | none                        | none                             |
| `user`     | any signed-in user                       | `donor`, `merchant`         | none                             |
| `any`      | user or anonymous device                 | `donor`, `merchant`, `anon` | none                             |
| `merchant` | merchant token                           | `merchant`                  | `not-staff`, `owner` or `member` |
| `anon`     | anonymous device only                    | `anon`                      | none                             |

The suite fails when a route is missing from the table or a table entry has no route. It checks the
middleware of each class (public routes carry no `auth:sanctum`; others do; a declared
`ability:` or `abilities:` list equals the classified abilities; the anon token rule admits anon
exactly where the class allows it) and exercises each route with real tokens of every principal:
guest, anonymous, banned anonymous, donor, owner, staff, deactivated user and revoked token. Expected
answers follow ADR-0013: 401 `auth.unauthenticated`, 403 `forbidden`, otherwise the request reaches
the controller. Problem bodies hold exactly `type`, `title`, `status`, `code` and `request_id`.

### Anonymous devices may browse the directory

`GET shops` and `GET shops/{slug}` carry `ability:donor,merchant,anon`. Without it a recipient could
not discover shops and items to reserve from, although the matrix allows it. The anon token rule
admits a device token on any `ability:` any-of list that names `anon`; an `abilities:` all-of list
with more names never admits it. Exactly four API routes admit device tokens: `anon/me` delete,
`hooks/reserve`, `shops` and `shops/{slug}` (asserted).

### Policies and matrix rows

`ItemPolicy::viewAny(actor, Shop)` (owner and staff) and `ShopDocumentPolicy::confirm` were added so
`GET shops/{id}/items` and the document confirm call go through `Gate::authorize`. Two matrix rows
were added to document section 3.2. The route matcher compares path shapes and ignores parameter
names. After this phase `PENDING` rows remain only for donations (three), payouts, `pay/{token}`,
`pay/callback` and `webhooks/iyzico`; admin operations (matrix section 4) are proven through gates
until the panel exists.

### Other decisions

- Lookup before authorization: a donor asking for an unknown shop id gets 404, not 403.
- IDOR sweep (`tests/Security/IdorPhase2Test.php`): a second owner and a second shop's staff against
  every owner and member route get 404 with bodies free of the first shop's data; a code from one
  shop redeemed at another is the same 422 as an unknown code and the unit stays `RESERVED`.
- Anonymity rules AN-1, 2, 3, 5, 6, 7 and 8 are asserted over a real reserve and redeem flow
  (`tests/Security/AnonymityRulesTest.php`); AN-4 is asserted over the parameterless GET routes of
  the web, admin and Horizon surfaces for each admin role.
- A JWKS outage answers 503 `service_unavailable` (it was `server_error`), still failing closed.

## Consequences

- Adding an endpoint requires a classification entry and a matrix row, or the suite fails.
- Shops form requests have no `authorize()` yet, so validation runs before the controller's
  authorization: a stranger sending an invalid body to an owner route gets 422 before 404 or 403. It
  leaks only validation rules. The hooks requests authorize first. Moving the shops requests to the
  same pattern is a suggestion, not built.
- The classification suite builds one world per case and is slow (about 3 minutes).
