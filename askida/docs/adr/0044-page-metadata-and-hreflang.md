# ADR-0044: Page metadata and hreflang policy

- Status: Accepted
- Date: 2026-10-05
- Deciders: Ayberk (owner) delegated engineering decisions inside the specification.

## Context

The specification asks for Turkish as the primary language and English as secondary. Translating 30
pages, five guides and sample legal texts has no search intent behind it ("askıda ekmek" is a
Turkish tradition), but a second locale proves the metadata model.

## Decision

- `App\Support\Web\PageMeta` is the single input of `<x-web.head>`: title at most 60 characters,
  description at most 155, canonical, alternates, robots (default `index,follow`), OG image, OG type,
  JSON-LD list, dates. The constructor throws on a longer title or description and on a canonical or
  OG URL outside `config('web.origin')`.
- The origin is `WEB_ORIGIN` (default `https://askida.app`), never the request host (tested with a
  foreign `Host` header).
- hreflang: every page emits `tr-TR` and `x-default`, both the Turkish URL. `en` is emitted only
  where an English page exists: `/en` and `/en/how-it-works`, linked reciprocally with `/` and
  `/nasil-calisir`. The two English pages are real prose, render `<html lang="en">`, and link back to
  the Turkish site, saying the full site is Turkish.
- The shared `WebPage` test helper takes the expected language instead of asserting `lang="tr"`.

## Consequences

- `HreflangTest` asserts canonical equals the page's own URL, `en` only on the four reciprocal pages,
  and `lang` per page; `MetaLengthTest` asserts length limits, uniqueness per page and equal OG text.
- `/en` carries no `BreadcrumbList` and no `MobileApplication` block (treated as a home page; the
  breadcrumb rule exempts `/`). Adding `MobileApplication` to `/en` is a suggestion, not built.
- Adding a third English page means adding a `translations` entry and a test row, nothing else.
