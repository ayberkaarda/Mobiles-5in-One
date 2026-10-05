# ADR-0054: Stored-XSS sweep and the rendering-surface inventory

- Status: Accepted
- Date: 2026-10-05
- Deciders: Ayberk (owner) delegated engineering decisions inside the specification.

## Context

Security checklist item 16 is verified by a stored payload that renders as text "on web and in
Filament". Text written by merchants, donors and staff is shown again on public pages, JSON-LD,
the sitemap, share images, plain-text files, the payment page, the admin panel, mails, push
messages and the API. A substring grep for a payload is not a valid check: escaped text such as
`&lt;img onerror=` legitimately contains `onerror=`, and a grep would both false-fail and miss a
real breakout.

## Decision

- Dataset `server/tests/Datasets/XssPayloads.php`: 12 general payloads and 2 JSON-LD breakout
  payloads (`</script><script>…` and `<!--<script>`). The planned `{{ }}` and `@{{ }}` template
  payloads are combined into one payload together with `{!! !!}`.
- Payloads enter only through the real write paths (`POST shops`, items, `PATCH me`, the panel's
  free-text actions through Livewire). Only columns no client can write (verification state,
  snapshot columns written by jobs) are set directly.
- Assertions are context aware (`server/tests/Security/Xss/XssSurface.php`):
  - public HTML is parsed with `DOMDocument`: no script element except `application/ld+json`
    blocks (exact count), no `<style>`, no `style` attribute, no `on*` attribute, no URL attribute
    starting with `javascript:` or `data:` or pointing at a foreign host, payload present as text;
  - every ld+json block encodes `<`, `>` and `&` (`JSON_HEX_TAG|JSON_HEX_AMP`), contains no
    `</script`, decodes, and equals the stored values;
  - admin panel pages ship the framework's own scripts, so they are compared with a rendering of
    benign text of the same length: element and attribute structure and the dangerous URL
    attributes must be identical;
  - mails are really rendered (array mailer), HTML parts parsed like web pages, text parts never
    contain a raw `<script`;
  - XML parses; JSON keeps `Content-Type: application/json` and `nosniff` and decodes to the stored
    string; the share image is a valid 1200x630 PNG; `/llms-full.txt` carries no shop input.
- Negative controls: `DetectorTest` runs the detectors against crafted dangerous markup and must
  fail on each; the sweep was also run against two deliberately broken views and failed.
- Unescaped output sites are pinned by `RenderingSourcesTest`. **Deviation from the Phase 6 plan,
  which allowed exactly one `{!! !!}`:** there are two, both justified and pinned:
  `resources/views/components/web/prose.blade.php` (purified Markdown of guides and legal pages,
  HTMLPurifier allowlist) and `resources/views/web/pay/checkout.blade.php` (the payment provider's
  checkout form markup, on a page with its own CSP profile; donor and shop texts on that page are
  escaped). Any new `{!!`, `@verbatim`, `<?=`, `HtmlString`, `->html()`, `ViewField` or `RawJs` in
  views or panel code fails the test until reviewed.
- Accepted: the admin panel CSP keeps `unsafe-inline` and `unsafe-eval` (Livewire and Alpine in
  Filament). The panel's defence against stored XSS is output escaping, which is why the panel
  surfaces are verified by structure comparison. The panel stays behind the IP allowlist, TOTP and
  a strict session.
- Accepted: push titles and bodies carry stored shop and item names verbatim. Native notifications
  do not interpret HTML; the contract tested is lossless transport inside one JSON string. Any
  client that renders notification text as HTML must escape it.

## Consequences

- Retest: `php artisan test --compact tests/Security/Xss` and
  `grep -rn "{!!" askida/server/resources/views` (two lines expected).
- Recorded on the delivering branch: the directory run had 266 passed and 1 failed; the failure was
  a test flake (the log masking processor rewrote digit runs of random UUIDs in the push check),
  fixed with fixed ids, and the push check then passed 14 of 14. A clean run of the whole directory
  on the final tree is part of the final whole-suite run (ADR-0064).
- Text mails escape values with HTML entities (`A & B` arrives as `A &amp; B` in the text part): a
  display defect, not an XSS; left as a product decision.
- not exercised: browser execution of the pages (structure analysis only), real mail client
  rendering, real push delivery.
