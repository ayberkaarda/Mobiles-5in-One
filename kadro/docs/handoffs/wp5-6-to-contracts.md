# Handoff admin web panel → contracts

- From: admin web panel (`apps/web/app/(admin)/**`, `apps/web/components/admin/**`,
  `apps/web/lib/admin/**`, ADR-0068)
- To: owner of `packages/contracts` (`admin.ts`, `endpoints.ts`)
- Status: open (nothing blocks the panel; these are gaps it works around)

## 1. Caller's step-up and enrollment state

No endpoint tells a staff session whether its step-up window is open, when it ends, or whether
the account has an active TOTP secret. The panel learns this only from errors: a list read that
answers 401 `step_up_required` leads to `/admin/dogrulama`, and a step-up that answers 409
`totp_not_enrolled` shows the enrollment link. The panel therefore cannot show the remaining
window or send an unenrolled staff member straight to enrollment.

Request: `GET /api/v1/admin/session` (staff, no step-up, no group limit) answering
`{ stepUpUntil: isoDateTime | null, totpEnrolled: boolean }` from the current session, with the
matching matrix row in §3.8.

Acceptance: the endpoint is in the registry and the OpenAPI document; non-staff → 403 before any
read; the step-up window of another session of the same account is never reported.

## 2. Closed set of venue import issue codes

`venueImportIssueSchema.issue` is any `^[a-z][a-z_]{0,63}$` string. The worker produces a fixed
set (`too_many_rows`, `invalid_quote`, `unterminated_quote`, `missing_header`, `missing_column`,
`unknown_column`, `duplicate_column`, `column_count`, `required`, `reserved`, `formula_like`,
`invalid_number`, `invalid_integer`, `invalid_boolean`, `out_of_range`, `price_range`,
`too_big`, `unknown_district`, `internal_error`, plus zod codes from the `POST venues` schemas),
and the panel keeps a Turkish label per code in `components/admin/labels.ts`, falling back to the
raw code. A new worker code would silently show as raw text.

Request: export `VENUE_IMPORT_ISSUE_CODES` (and narrow `issue` to that enum) from
`packages/contracts/src/admin.ts`, used by the worker and by the panel's label map.

Acceptance: the worker and the panel import the same list; a test fails when a label is missing.

## 3. District labels for admin lists

`adminVenueSchema` carries `districtId` only. The panel resolves `il / ilçe` labels with one read
of the `districts` reference table per page (`lib/admin/server-api.ts` `districtLabels`), since
`GET /api/v1/districts` is not on the base branch.

Request (optional): add `district: { id, il, ilce }` to `adminVenueSchema`, or let the panel use
`GET /api/v1/districts` once it is merged.
