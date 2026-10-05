# ADR-0045: JSON-LD coverage and test-based validation

- Status: Accepted
- Date: 2026-10-05
- Deciders: Ayberk (owner) delegated engineering decisions inside the specification.

## Context

Structured data helps search and answer engines, but Rich Results and Search Console need a public
URL and a domain, which this portfolio build does not have.

## Decision

- Every page emits `Organization` (legal name, `url`, `logo` at `/logo/askida-mark.svg`) first and a
  `BreadcrumbList` except on `/` and `/en`. Per page: `/` `MobileApplication` (category
  `LifestyleApplication`, Android and iOS, free offer in TRY, `installUrl` only when a store URL is
  configured); shop pages a `LocalBusiness` subtype by shop type (bakery `Bakery`, restaurant
  `Restaurant`, cafe `CafeOrCoffeeShop`, grocery `GroceryStore`, stationery and other `Store`) with
  `PostalAddress` (`addressCountry: TR`), `GeoCoordinates`, `openingHoursSpecification` (open days
  only, omitted without hours) and `telephone` (omitted when not a +90 number); `/sss` `FAQPage`
  with exactly the 15 pairs rendered on the page; guides `Article` (dates and `wordCount` from front
  matter, `inLanguage: tr-TR`); `/etki` `Dataset` (see ADR-0049).
- Every block is encoded with `JSON_HEX_TAG | JSON_HEX_AMP` through `@json(..., JsonLd::FLAGS)`, so
  no value can close the script element; there is no `{!! !!}` in this layer. `@context` is added
  centrally.
- Validation is a Pest test, `JsonLdTest`: every block on every public page parses, `@context` is
  `https://schema.org`, required properties per type come from a map in the test (an unknown type
  fails), no empty string, list or null, every URL absolute on `web.origin`. Exemptions are explicit:
  `MobileApplication.installUrl` must equal a configured store URL, and `dayOfWeek` values are
  schema.org enumeration URLs. Negative fixtures prove the validator fails.

## Consequences

- The required-property map is the project's own reading of schema.org, not the output of an
  external validator.
- not exercised: Google Rich Results test and Search Console enhancement reports: no public URL and
  no domain.
