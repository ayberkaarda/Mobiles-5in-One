# ADR-0050: Guides and content pipeline

- Status: Accepted
- Date: 2026-10-05
- Deciders: Ayberk (owner) delegated engineering decisions inside the specification.

## Context

Five Turkish guides (at least 600 words each) and two legal texts must be editable as plain text,
carry the same numbers as the rest of the site, and never open an injection path into the layout.

## Decision

- Sources are Markdown files in `resources/content/guides/` (the five slugs fixed by the phase
  contract) and `resources/content/legal/`. Front matter keys, all required: `slug` (must equal the
  file name), `title`, `description`, `answer` (the 40-60 word paragraph under the H1), `published`,
  `updated`. Dates come from the front matter only, never from the clock; all five guides carry
  2026-10-04 for both, because that is when they were written.
- Facts are `{{token}}` placeholders (commission, code length and validity, anonymous caps, radius,
  quantity limit, transaction and day caps, KVKK version, legal name) filled from `Facts` before
  conversion; an unknown token throws, and a test rejects hard-coded percentages, minutes, kilometres
  and prices in the sources.
- Conversion: `league/commonmark` with `html_input: strip`, `allow_unsafe_links: false` and the table
  extension, then `ezyang/htmlpurifier` with the allowlist
  `p,h2,h3,ul,ol,li,a[href],strong,em,blockquote,code,pre,table,thead,tbody,tr,th,td`, http and https
  schemes only, external links disabled except the own host (relative links, `mailto:`, `tel:`,
  `javascript:` and `data:` are dropped), no definition cache. The result is wrapped in `PurifiedHtml`,
  the only input of `<x-web.prose>`, which holds the codebase's single unescaped output.
- Guide pages `/rehber/{slug}` (slug `[a-z0-9-]+`, unknown is 404): every H2 is a question followed
  directly by a short answer; `Article` JSON-LD (ADR-0045); a "Diğer rehberler" list; no `/rehber`
  index. Word counts (642 to 686 in the body) are asserted by test.
- Every guide ends with a section stating that the app is not published, that figures are labelled
  samples and that the commission is a sample rate. No claim of real shops or impact numbers.
- `/llms.txt` is built by a PHP class, not a Blade view (Blade escaping would alter apostrophes and
  `{!! !!}` is reserved for prose): 1 733 bytes at the defaults against a 2 048 limit, with the
  definition, three personas, redemption facts, the anonymity guarantee, the commission sentence and
  exactly 10 links. `/llms-full.txt` (39 625 bytes) concatenates the about facts, the 15 FAQ pairs,
  guides and legal texts from the same sources. Both are `text/plain; charset=utf-8` and pass through
  the page cache.

## Consequences

- Changing a limit in config changes every page, guide, FAQ entry, `llms.txt` and JSON-LD block
  together; the 750 bps re-render test proves nothing hard-codes the commission.
- The sitemap reads the same front matter for `lastmod` (ADR-0048).
- not exercised: legal or editorial review of the guides, Rich Results on an Article page (no
  domain), dark scheme and visual review of the guide layout in a browser.
