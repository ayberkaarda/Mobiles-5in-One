# ADR-0040: Content pages and GEO files

- Status: Accepted (the legal texts are drafts pending legal review, see below)
- Deciders: Project owner (decision delegated to the lead)
- Phase: 4, package 4D (builds on ADR-0038 and ADR-0039)

## Context

Section 7 asks for guides under `/rehber/[slug]`, `/sss` with 15 Turkish Q&A pairs mirrored in
`FAQPage` JSON-LD, `/veri` with `Dataset` data, `/hakkinda`, `/veri-lisansi`, `/gizlilik`,
`/kvkk-aydinlatma`, `/hesap-silme`, `/iletisim`, `/llms.txt` and `/llms-full.txt`, and one entity
description across all of them. ADR-0003 leaves the data licence proposed with legal approval
pending, ADR-0026 fixes the deletion flow, ADR-0022 the trace privacy, ADR-0034 the offline pack
behaviour, ADR-0021 the moderation process. The repository holds no contact address and no terms
of use draft.

## Decision

1. **Content is data.** `apps/web/src/content/` holds typed blocks (`blocks.ts`), the entity facts
   (`facts.ts`), five guides (`guide-*.ts`, `guides.ts`), the FAQ (`faq.ts`), the static pages
   (`pages.ts`) and the llms builders (`llms.ts`). No Angular imports, so the same data feeds the
   page, the JSON-LD, `llms.txt` and the tests. Text is rendered by template bindings
   (`content-blocks.component.ts`); no HTML string, no sanitizer bypass.
2. **One facts module.** Name, tagline, description, cities, licence status line, export cadence,
   trace trim (200 m), trace retention (30 days) and deletion grace (7 days) live in
   `facts.ts`. `homeSeo()` now takes its description from it (one line in `home/home.ts`), so the
   home page, `/hakkinda`, the FAQ, `llms.txt` and the Organization data cannot differ.
3. **Routes.** The nine fixed pages and `rehber/:slug` are registered through one spread in
   `app.routes.ts` and one in `app.routes.server.ts`, before `:sehir`. A resolver reads local
   data (no API call); an unknown guide is a real 404 through `PageView`.
4. **Render mode.** The guides and static pages use `RenderMode.Server` behind the 10 minute page
   cache, not a build-time prerender. ADR-0038 item 6 states that no route is prerendered so
   canonical URLs never hold a build-time origin; a prerender here would bake one in. The
   specification's "prerender for guides" is therefore not followed literally; the pages are
   still complete HTML on first response (checked with JavaScript disabled).
5. **JSON-LD** only through the 4B builders: `Article` (+ `BreadcrumbList`) on guides, `FAQPage`
   built from the same `FAQ` array as the visible list, `Dataset` on `/veri`, `Organization`,
   `WebApplication` and `MobileApplication` on `/hakkinda`. `Dataset.license` is the builder's
   required site path; it points at `/veri-lisansi`, which states that no licence is granted yet,
   because ADR-0003 forbids a machine-readable licence declaration before approval.
   `Dataset.dateModified` is the content date, since no static page can know the export time; the
   live export carries its own `exported_at`.
6. **Machine files.** `registerContentFiles` (`content/llms-route.ts`, called once from
   `server/app.ts` after `robots.txt`) serves `/llms.txt` and `/llms-full.txt` as
   `text/plain; charset=utf-8` and `/sitemap-pages.xml` (static pages without the noindex ones,
   `lastmod` = content date). They are built from the same facts and need no API. Since the phase
   4 review `/sitemap.xml` lists `/sitemap-pages.xml` first, with the same content date
   (`server/machine-files.ts`).
7. **Honesty rules, enforced by tests** (`content.spec.ts`, "legal and honesty rules"; each rule
   names its assertion in Evidence; the contact-data and licence checks also have negative tests
   that inject a violation and expect the check to fail).
   - Licence: "CC BY 4.0 önerilmiştir; hukuki onay bekleniyor, henüz verilmiş bir lisans yok",
     one string, shown on `/veri`, `/veri-lisansi`, `llms.txt` and the FAQ.
   - `/kvkk-aydinlatma` is marked "Taslak" at the top and in the heading and is `noindex`; it
     names the legal name `İnecek Var Teknoloji` from the specification and says that address,
     registry and MERSİS data, legal bases, processors and countries come after legal review. No
     registration number or address is invented.
   - `/iletisim` says the contact channel is being set up and publishes no address (none exists
     in the repository). It is `noindex`.
   - `/hesap-silme` says there is no web deletion form in this phase and that deletion runs in
     the app (also reachable in the web app on `app.inecekvar.app`). No form element exists.
   - Guides state no fare, no named line and no operator; fares point to the dated line page.
   - `/kullanim-kosullari` is not created: no draft exists. It is listed in `OPEN_PAGES` and in
     `docs/seo/checklist.md`.
   - Cities: the target list is described as a target; coverage is the published line count on
     the city page.
8. **No contact or social links, no analytics, no storage** (public pages only; the staff area
   under `/admin` sets the session and CSRF cookies and a logout marker in web storage, and
   `/gizlilik` and the FAQ say so since the phase 4 review): the pages add no script, cookie or
   request beyond the existing SSR bundle (lazy chunk `content-page`, about 7 kB).

## Consequences

- Guides are text in TypeScript. Editing a guide is a code change and passes the same gates;
  there is no CMS. A word-count test keeps every guide at 600 words or more.
- Correctness of guide statements about the app depends on ADR-0021, ADR-0022, ADR-0024,
  ADR-0026 and ADR-0034; a change of those behaviours needs the matching guide edit.
- `/sitemap-pages.xml` is listed by `/sitemap.xml` since the phase 4 review (it was missing in
  the first version of this package).
- Store title: the specification fixes `İnecek Var: Dolmuş & Minibüs Hatları` (36 characters,
  `FACTS.storeTitle`), above the 30 character cap of both stores. `docs/seo/aso.md` records the
  options; choosing between them is the owner's decision, not this package's, and nothing is
  submitted before it.

## Evidence

| # | Check | Command or test | Result |
| - | ----- | --------------- | ------ |
| 1 | Web gate | `pnpm nx run-many -t lint test build -p web --skip-nx-cache` | lint, test and build succeeded; 32 test files, 608 tests |
| 2 | Word counts (heading + body, data level) | `content.spec.ts`, `content.page.spec.ts` (rendered `article` text) | 703, 667, 663, 669, 659 words, all at least 600 |
| 3 | FAQ | `content.page.spec.ts` | 15 sections; question/answer pairs equal the `FAQPage` `mainEntity` entries |
| 4 | Links | `content.spec.ts`, e2e `every internal link on every content page resolves` | every internal link is a registered route; crawled links answer 200 |
| 5 | Metadata | `content.spec.ts` | titles within 60 characters with the suffix and no ellipsis, descriptions 60 to 155, all unique |
| 6 | Text rules | `content.spec.ts` | CI banned-word expression absent, Turkish letters intact, NFC, no e-mail, phone or registration-like numbers |
| 7 | llms | `llms-route.spec.ts`, e2e `llms files are served as UTF-8 plain text` | 200, `text/plain; charset=utf-8`, same name, tagline, description, licence line |
| 8 | Web e2e on the production build | `pnpm nx run web-e2e:e2e` | 50 passed (39 earlier + 11 content tests: five guides without JavaScript, FAQ mirror, Dataset, noindex and no form, link crawl, 404, llms) |
| 9 | Formatting and words | `prettier --check` on the changed files; the CI banned-word grep | clean |
| 10 | Honesty assertions per rule (`content.spec.ts`, "legal and honesty rules") | licence: "states the licence is proposed and approval is pending", "states the licence as pending wherever the proposed licence is named"; KVKK draft: "marks the KVKK text as a draft and keeps it out of the index"; contact data: "invents no registration numbers, addresses or contact addresses"; deletion: "says the web deletion flow does not exist and shows no form"; contact: "says the contact channel is being set up"; terms: "lists the terms of use as open work because no draft exists"; numbers: "keeps the trim, retention and grace numbers aligned with the ADRs"; storage: "scopes the no-cookie promise to public pages and names the staff area cookies" | all green |
| 11 | Negative test: invented contact data | "fails the honesty check when a page gains %s" (e-mail, two phone forms, MERSİS, tax number, street address, social handle injected into a page text) | each case flags its kind; the local phone, address and social patterns were added for this test. Mutation "a page gains `Telefon: 0 (212) 555 01 01`": red "invents no registration numbers, addresses or contact addresses"; restored |
| 12 | Negative test: licence presented as granted | "fails the licence check for the granted-licence claim %s" (4 sentences) | each flagged. Mutation "`FACTS.licence.statusLine` = `Veriler CC BY 4.0 lisansı altında yayımlanır.`": red "states the licence as pending wherever …" and "states the licence is proposed …"; restored |
| 13 | Review fix: cookie sentences (`/gizlilik`, FAQ) | "scopes the no-cookie promise to public pages and names the staff area cookies" | mutation "old unscoped sentence on `/gizlilik`": red; restored |

## Not exercised

- `not exercised: Rich Results Test, schema.org validator, Lighthouse and Search Console` (no
  public host; see `docs/seo/checklist.md`).
- `not exercised: legal review` of `/kvkk-aydinlatma`, `/gizlilik` and `/veri-lisansi`; the first
  is a draft, the other two describe current behaviour and the pending approval.
- `not exercised: web account deletion form` (does not exist by design in this phase).
- `not exercised: real search or answer-engine crawlers fetching llms.txt`.
- `not exercised: Firefox and Safari`, and the pages in a real mobile browser (Chromium only).
- Open: `/kullanim-kosullari`, a real contact channel, English pages, an OG image for content
  pages, a per-city export link list on `/veri`, the store title decision (owner).
