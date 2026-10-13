# Stored-XSS sweep (security checklist item 16, Verify)

Scope: every place where text written by a contributor, a moderator or an account holder is shown again on the web (SSR and hydrated), in the admin area and in the PWA. A fixed payload list is written through the real write paths into the real API, and every rendering surface is asserted to show the payload as text: no element, attribute, handler or URL scheme created from it, no dialog, no CSP violation, JSON-LD parsing back to the stored string. Package 6B, ADR-0052.

## Method

- **Payload list**: `api/tests/security/payloads.py`, the same list as `apps/web-e2e/src/xss-payloads.json` (kept identical by `test_attack_suite.py::test_payload_file_matches_the_python_list`): the 14 payloads of the Askida sweep (`askida/docs/security/xss-sweep.md`) plus 9 Inecek Var cases, 23 in total.
- **Write path** (`apps/web-e2e/src/xss-world.ts`, shared by both specs): a contributor registers through `POST /v1/auth/register` with the link read from Mailpit, accepts the licence, sets a hostile display name (`PATCH /v1/me`), proposes one stop per payload (`new_stop`, name), one line per payload (`new_line`: name, hours text, hailing notes; code `X-n`), one fare change per line and one rename per line. A second account, made moderator, approves the stops and lines, rejects every fare change with the payload as the reason (`POST /v1/moderation/edits/{id}/reject`) and leaves the renames pending for the queue; the moderator also has a hostile display name. Only the city row (no API creates cities), the roles and the contributor's reputation (an admin grants them in production) are written with `psql`, as in the phase 4 moderation run. Each run uses a fresh city (`xss-<time>`), so reruns never collide.
- **Field limits**: each payload is stored cut to the field limit (name 160, hours 500, notes 1 000, reasons 1 000, display name 60, code points); the full over-limit values are refused at validation (`test_payloads_round_trip_as_json_text_or_are_refused`, `input-constraints.md`).
- **Assertions are structural, never substring greps of markup** (escaped text such as `&lt;img onerror=` contains `onerror=` legitimately). `auditDocument` in `xss-world.ts` runs in the browser on the live DOM or on an SSR string parsed with `DOMParser` (nothing in it runs) and reports: any attribute named `on*`; `href`/`src`/`action`/`formaction`/`xlink:href`/`data`/`poster` values starting with `javascript:`, `vbscript:`, `data:text` or `data:image/svg` after removing whitespace and control characters; elements a payload would create (`img[src=x]`, `iframe`, `object`, `embed`, a `base` other than the app's `href="/"`, `meta` refresh, SVG `image`, `b`, an attacker stylesheet link, a `style` with `@import`); scripts that are neither data blocks (`application/ld+json`, `application/json`), bundles (`src`) nor nonced (plus the PWA build's one critical-CSS loader); and, for SSR strings, more `</script` sequences than script elements. Hydrated pages also fail on any `dialog` event and any `securitypolicyviolation` event (recorded from page start). The visible text must contain the stored value exactly (`textContent`), and JSON-LD blocks must parse with one string value containing it.

## Payloads and input outcome

| # | name | value (abridged) | API outcome |
| --- | --- | --- | --- |
| 1 | script-element | `<script>alert(1)</script>` | stored as text |
| 2 | img-onerror | `<img src=x onerror=alert(1)>` | stored as text |
| 3 | javascript-href | `<a href="javascript:alert(1)">tikla</a>` | stored as text |
| 4 | svg-onload | `<svg onload=alert(1)>` | stored as text |
| 5 | attribute-breakout | `"><svg/onload=alert(1)>` | stored as text |
| 6 | template-braces | `{{7*7}} {{constructor.constructor('alert(1)')()}}` | stored as text |
| 7 | template-literal | `${7*7}` | stored as text |
| 8 | markdown-javascript-link | `[tikla](javascript:alert(1))` | stored as text |
| 9 | entity-double-encoding | `&amp;lt;script&amp;gt;...` | stored as text |
| 10 | style-import | `<style>@import url(//attacker.test/a.css)</style>` | stored as text |
| 11 | long-markup | 40 x `<b onmouseover=alert(1)>x</b>` (1 160) | stored cut to each limit; full value 422 |
| 12 | rtl-override | U+202E `<script>alert(1)</script>` U+202D | **refused, 422 `validation.failed`** (input validation) |
| 13 | closing-script | `</script><script>alert(1)</script>` | stored as text |
| 14 | comment-opener | `<!--<script>` | stored as text |
| 15 | line-separators | `a` U+2028 `b` U+2029 `c</script>` | stored as text (category Z is allowed) |
| 16 | json-ld-breakout | `"}</script><script>alert(1)</script>` | stored as text |
| 17 | javascript-url | `javascript:alert(1)` | stored as text (no link field exists in the data model) |
| 18 | data-url | `data:text/html;base64,...` | stored as text (no link field exists) |
| 19 | svg-image | `<svg><image href=x onerror=alert(1)></image></svg>` | stored as text |
| 20 | bidi-isolate | U+2066 `abc` U+2069 U+202B `def` U+202C | **refused, 422** (input validation) |
| 21 | zero-width | `a` U+200B `b` U+200D `c` U+FEFF `d` | **refused, 422** (input validation) |
| 22 | nul-byte | `a` U+0000 `<script>alert(1)</script>` | **refused, 422** (input validation) |
| 23 | very-long | `A` x 5 000 | stored cut to each limit; full value 422 |

The four refused payloads are recorded as input validation, not as output-escaping passes: the web spec asserts `422 validation.failed` for each as a stop name and as a display name (`payloads with control or format characters are refused at input validation`), the API suite for line name, hours and notes and for the display name. The other 19 reach every surface below.

## Surfaces x payloads

Every row ran all 19 stored payloads (cut to the field's limit) unless a count is given; "pass" means every assertion of the method held.

| Surface | Fields shown | Assertions | Result |
| --- | --- | --- | --- |
| Web SSR, city hub `/{city}` (no JS) | city name, recent lines | structural audit of the SSR string | pass |
| Web SSR, line list `/{city}/hatlar` | 19 line names | audit + each name in text | pass 19/19 |
| Web SSR, line page `/{city}/hat/x-n` | name, hours, notes, stop names | audit + exact text + JSON-LD (BreadcrumbList, BusTrip) parses with the name | pass 19/19 |
| Web SSR, stop page `/{city}/durak/{slug}` | stop name, lines | audit + exact text + JSON-LD (BusStop) parses with the name | pass 19/19 |
| Web SSR, route page `/{city}/rota/{a}-{b}` | both stop names | audit + text | pass (first 8 pairs of `stop-pairs`) |
| Web hydrated: hub, list, 19 lines, 19 stops, line with map | all of the above after Angular hydration | live audit, 0 dialogs, 0 CSP violations | pass 40/40 pages |
| OG image `/og/{city}/hat/x-n.svg` | line name, city name | parses as `image/svg+xml` without error, only `svg/rect/path/text/title` elements, no `on*`, text holds the name (U+2028/2029 removed by the writer) | pass 19/19 |
| Sitemaps `/sitemap.xml`, `/sitemaps/{city}.xml` | slugs only | XML parses, every `loc` is a slug path under the canonical origin | pass (38 detail URLs + hub and list) |
| `/llms-full.txt` | static facts | 200 text/plain, no payload present (no user data on this surface) | pass |
| Admin queue `/admin/kuyruk` (diff table) | pending rename (from/to), author display name | live audit, exact cell text, 0 dialogs, 0 CSP violations | pass 19/19 |
| Admin users `/admin/kullanicilar` (after step-up) | display names, emails | live audit, row text | pass (2 hostile names) |
| Admin versions `/admin/surumler` | line names in search and detail | live audit, text | pass |
| Admin audit log `/admin/denetim` | actions and ids (no free text stored, by design) | live audit, `moderation.reject` rows | pass |
| PWA search results `/ara` | line names for `X-` | live audit, text | pass |
| PWA line detail `/hat/x-n?city=` | name, hours, notes, stops | live audit, exact text, 0 dialogs, 0 CSP events | pass 19/19 |
| PWA stop detail `/durak/{slug}?city=` | stop name, lines | live audit, exact text | pass 19/19 |
| PWA planner suggestions `/planla` | stop names for `script`, `svg` | live audit, text | pass |
| PWA favourites `/favoriler` | 6 favourited line names | live audit, text | pass |
| PWA my proposals `/katki/onerilerim` | subjects, 19 rejection reasons | live audit, reason text, 19 rejected rows | pass |
| PWA pack manager `/ayarlar/cevrimdisi` | city names (operator data) | live audit | pass |
| API JSON (`/v1/lines`, edits, `/v1/me`) | every field | `application/json`, exact round trip | pass (`test_payloads_round_trip_as_json_text_or_are_refused`) |

PWA CSP: the PWA build sets no Content-Security-Policy (neither a meta tag nor the Caddy site block), so on the PWA the "0 CSP violations" check holds vacuously and the defence is Angular's text binding alone. Recorded as finding 2 in `attack-report.md`.

## Mutations (red, then restored)

| Mutation | Red in | Output |
| --- | --- | --- |
| SVG text unescaped (`libs/ui` `escapeXmlText` returns the raw text) | web `OG images, sitemaps and llms-full.txt stay well-formed` | `Error: script-element <script>`: a `script` element inside the OG SVG |
| JSON-LD `<` escape removed (`serializeJsonLd`) | web `SSR pages without JavaScript render every payload as text` | `Error: line script-element JSON-LD` (the block no longer parses back to the name) |
| Admin queue renders the proposed value with `[innerHTML]` | web `admin queue, diff, users, versions and audit log show payloads as text` | `Error: admin queue: injected elements` `["img src=x", "b element"]` |

Each source was restored and the full suites passed afterwards (web-e2e 63 passed, mobile-e2e 9 passed).

## Commands

```
cd inecekvar
IV_E2E_STACK=iv6b node apps/web-e2e/scripts/real-stack.mjs up
IV_E2E_STACK=iv6b IV_E2E_REAL_API=1 pnpm nx run web-e2e:e2e
# PWA: reset the stack, run uvicorn and the arq worker on 127.0.0.1:57957 with the iv6b
# environment (INECEKVAR_ENV=local, INECEKVAR_PRESIGN_TTL_SECONDS=30, a throwaway
# INECEKVAR_TOTP_ENCRYPTION_KEY), then:
IV_E2E_API=http://127.0.0.1:57957 IV_E2E_MAIL=http://127.0.0.1:57956 \
  IV_E2E_PSQL_CONTAINER=iv6b-postgres-1 IV_E2E_ORIGIN=http://localhost:4200 \
  pnpm nx run mobile-e2e:e2e
IV_E2E_STACK=iv6b node apps/web-e2e/scripts/real-stack.mjs down
cd api && INECEKVAR_ENV=test uv run pytest tests/security -q
```

Not exercised: native WebView rendering on a device (the Capacitor shell loads the same build), mail clients rendering the account mails, a hosted CDN or proxy in front of the SSR server.
