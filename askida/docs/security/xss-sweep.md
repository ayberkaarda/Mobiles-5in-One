# Stored-XSS sweep (security checklist item 16, Verify)

Scope: every place where text written by a merchant, a donor or staff is shown again. The sweep injects a fixed payload dataset through the real write paths and asserts, on every rendering surface, that the payload is displayed as text and never becomes markup, script, a URL scheme or a broken data block.

## Method

- **Dataset**: `server/tests/Datasets/XssPayloads.php`, 12 general payloads (`all()`) plus the 2 JSON-LD breakout cases (`jsonLd()`), 14 in total (`everything()`).

| # | name | value |
| --- | --- | --- |
| 1 | script element | `<script>alert(1)</script>` |
| 2 | img onerror | `<img src=x onerror=alert(1)>` |
| 3 | javascript href | `<a href="javascript:alert(1)">tikla</a>` |
| 4 | svg onload | `<svg onload=alert(1)>` |
| 5 | attribute breakout | `"><svg/onload=alert(1)>` |
| 6 | template syntax | `{{ 7*7 }} @{{ 7*7 }} {!! 7*7 !!}` (Blade text, must not be evaluated) |
| 7 | js template literal | `${7*7}` |
| 8 | markdown javascript link | `[tikla](javascript:alert(1))` |
| 9 | entity double encoding | `&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;` |
| 10 | style import | `<style>@import url(//attacker.test/a.css)</style>` |
| 11 | long payload | 40 repeats of `<b onmouseover=alert(1)>x</b>` (1 160 characters; cut to each field limit when stored, the over-limit refusal is tested separately) |
| 12 | rtl override | U+202E, `<script>alert(1)</script>`, U+202D |
| 13 | closing script tag (JSON-LD) | `</script><script>alert(1)</script>` |
| 14 | comment opener (JSON-LD) | `<!--<script>` |

- **Write paths** (no direct model writes of text): `POST /api/v1/shops` (name, address, il, ilce), `POST /api/v1/shops/{id}/items` (name), `PATCH /api/v1/me` (name), and the panel actions that take free text (shop rejection reason, payout hold reason, abuse flag review note, payment mismatch resolution note) through Livewire. Only the verification state of the shop and the technical snapshot columns written by background jobs (abuse flag detail, mismatch snapshots, unit rows) are set directly, because no client can write them.
- **Assertions are rendering-context aware** (`server/tests/Security/Xss/XssSurface.php`). Nothing greps the raw markup for a payload substring, because escaped text such as `&lt;img onerror=` legitimately contains `onerror=`:
  - public HTML pages are parsed with `DOMDocument`: the only `<script>` elements are `application/ld+json` blocks (exact count), no `<style>` element, no `style` attribute, no attribute named `on*`, no `href`/`src`/`action`/`formaction`/`poster`/`data`/`srcset` value starting with `javascript:` or `data:` (whitespace and case obfuscation removed first), no URL attribute pointing at a host other than the own origin or a configured store URL, and the payload is present as text (`h1` and cell text equal the stored string exactly);
  - JSON-LD: every `<script` and `</script` in the markup belongs to a parsed ld+json block, no block contains a raw `<`, `>` or `&` (they are `<`, `>`, `&`), no `</script` inside a block, each block decodes and the decoded values equal the stored strings;
  - admin panel pages carry the framework's own scripts, so they are not held to the public page rules. Each surface is rendered with the payload and again with benign text of the same length in the very same rows, and the element structure (element names plus sorted attribute names, document order) must be identical, the dangerous URL attributes must be identical, and no `on*` attribute may exist. A payload that became markup would add an element or an attribute. The payload must also be in the text content;
  - mail: really rendered through the array mailer (not `Mail::fake`). HTML part parsed (no script element, no dangerous attribute, same structure as the benign mail, value in a text node); text part never contains a raw `<script` and carries the Blade-escaped value;
  - XML (sitemap): parsed with libxml (a broken text node would fail) and every location is a slug path;
  - JSON (API): `Content-Type: application/json`, `X-Content-Type-Options: nosniff`, decoded value equals the stored string; problem responses never echo a rejected value;
  - PNG (share image): `200`, `image/png`, PNG signature, 1200x630;
  - plain text (`/llms-full.txt`): no raw `<script`, and no shop input at all.
- **Negative controls** (`DetectorTest`): the assertions are run against crafted dangerous markup (script element, script with `src`, `onerror`/`onload`, obfuscated `javascript:`, `data:`, `<style>`, `style` attribute, external host, extra ld+json block, a JSON-LD block a payload can break out of, an injected element in a panel table, a broken XML document, raw script bytes in text) and must fail on each. Additionally the sweep was run against two deliberately broken views (`{!! !!}` for the shop address on the shop page and for the shop name on the pay page, reverted afterwards): the web sweep failed on the extra script element, the stray `<script` start and the text mismatch.

## Surface inventory

| surface | test file | payload fields | checks |
| --- | --- | --- | --- |
| `/dukkan/{slug}` (name, address, il, ilce, item name, breadcrumbs, JSON-LD) | `WebSurfacesTest` | shop name, address, il, ilce, item name | inert page, text equal to stored value, ld+json unbreakable and equal to stored values, CSP unchanged (`script-src 'self'` + nonce, no `unsafe-inline`/`unsafe-eval`) |
| `/dukkanlar/{il}/{ilce}`, `/dukkanlar/{il}` | `WebSurfacesTest` | shop name, il, ilce | inert page, breadcrumb names equal to stored values |
| `/sitemap.xml` | `WebSurfacesTest` | all | parses, slug paths only |
| `/og/dukkan/{slug}.png` | `WebSurfacesTest` | shop name | 200, `image/png`, valid 1200x630 PNG |
| `/llms-full.txt` | `WebSurfacesTest` | shop name | no raw `<script`, no shop input |
| `/pay/{token}` | `WebSurfacesTest` | shop name, item name | `dd` text equals stored value, no script, same structure as benign page |
| `/d/{slug}`, payload slugs in URLs | `WebSurfacesTest` | slug | 301 to the slug path; script, breakout, `javascript:` and template slugs answer 404 on every route |
| unverified shop with payload | `WebSurfacesTest` | name | 404, absent from the sitemap |
| API: shop detail, list, items, my shops, `me` | `ApiSurfacesTest` | name, address, il, ilce, item name, user name | JSON content type, nosniff, decoded equals stored |
| API: validation problems | `ApiSurfacesTest` | phone, type, over-long name | 422 `validation.failed`, `application/problem+json`, value not echoed, nothing stored |
| panel: shop queue, shop view, donations, payouts, abuse flags, payment mismatches, activity log | `PanelSurfacesTest` | shop name/address/il/ilce, item name, hold reason, review note, resolution note, abuse flag detail, mismatch snapshots, rejection reason | payload as text, structure equal to the benign rendering |
| mails: receipt, refund, verification, password reset, deletion notice, payout hold alert, payment mismatch alert, settlement mismatch alert | `MailAndPushTest` | shop name, item name, user name, alert values | HTML inert and structure-equal, text part escaped, no raw `<script` |
| push payload (`LogPushTransport` output) | `MailAndPushTest` | item name, shop name | one JSON line per message, decoded message equals the built message (lossless transport) |
| unescaped output sites in views and panel code | `RenderingSourcesTest` | - | see below |
| markdown to HTML (guides, legal pages) | `RenderingSourcesTest` | payload as paragraph, link target and table cell | allowlisted elements only, no attributes except `href`, no `javascript:`/`data:` |

### Unescaped output sites

`RenderingSourcesTest` pins every place that prints without escaping:

| site | why it is safe | pinned by |
| --- | --- | --- |
| `resources/views/components/web/prose.blade.php:2` (`{!! $html !!}`) | only fed by the guide and legal pages with `PurifiedHtml` from `ContentRenderer` (Markdown with raw HTML stripped and unsafe links refused, then the HTMLPurifier allowlist) | the two callers are listed and must pass `$guide->body` / `$page->body` |
| `resources/views/web/pay/checkout.blade.php:17` (`{!! $checkout !!}`) | the payment provider's checkout form markup kept in `PayPageStore`; the donor's and shop's texts on the same page are escaped; the page has its own CSP profile (`frame-src` and `script-src` limited to configured provider hosts, nonce added to the provider's inline scripts by `PayController::withNonce`) | line pinned; see "Open questions" |

Any new `{!!`, `@verbatim`, `<?=`, `HtmlString`, `->html()`, `ViewField`, `RawJs` in views or `app/Filament` fails the test until reviewed. The only panel use of `HtmlString` is the empty stand-in returned by the financial reveal modal when nothing is revealed. The navigation component reads `request()->getPathInfo()` only to compare it with a fixed link list and never prints it.

## Findings

No stored-XSS vulnerability was found, so no production change was made (`resources/views/**` and `app/Filament/**` untouched). Observations:

1. **Text mails escape their values with HTML entities.** The plain-text parts use `{{ }}`, so a shop called `A & B` is delivered as `A &amp; B` in the text part. It is not an XSS (text parts are not rendered as HTML) but a display defect for names with `&`, `<`, `"`. Fix, if wanted: print text-part values with `{!! !!}` after stripping tags, or with `e()` replaced by a plain-text formatter. Outside the xss worker's ownership (mail templates are views, but changing the escaping rule of five templates is a product decision); recorded, not changed.
2. **Admin panel CSP allows `unsafe-inline` and `unsafe-eval`** (documented in `config/secure-headers.php` for Livewire and Alpine). The panel therefore relies on output escaping alone, not on the policy, as a defence against stored XSS. This is why the panel surfaces are verified by structure comparison.
3. **Push text is plain text**: a stored shop or item name is placed into the notification title or body verbatim. Native notifications do not interpret HTML, so the contract tested is lossless transport inside one JSON string. If a client ever renders notification text as HTML, it must escape it.
4. **The gate text "`{!!` appears exactly once" does not match the code**: there are two sites (prose and pay checkout), both justified above. The test pins both.

## Retest

```
docker compose -p <project> exec -T server php artisan test --compact tests/Security/Xss
grep -rn "{!!" askida/server/resources/views
```

Expected: all tests pass; the grep returns the two lines of the table above.
