# ADR-0080: Blog and legal pages — content files rendered to React elements, sample labels on legal text

- Status: Accepted
- Date: 2026-10-03
- Deciders: Engineering (product spec §0.7), reported to Ayberk (owner)
- Related: ADR-0021, ADR-0055 (nonce CSP, JSON-LD helper), ADR-0056 (marketing shell), ADR-0057
  (programmatic pages, sitemap), ADR-0059 (quality gates), ADR-0078 (audit exception);
  `docs/legal/review-checklist.md`; product spec §7

## Context

Five blog articles (`apps/web/content/blog/*.mdx`) and two legal texts
(`apps/web/content/legal/*.mdx`) were merged without routes. Product spec §7 lists `/blog/[slug]`,
`/gizlilik`, `/kvkk-aydinlatma`, `/iletisim` and the `Organization` and `MobileApplication` structured
data. Two constraints shape the renderer: every HTML page renders per request with the nonce CSP
(ADR-0055), and the source guards forbid `dangerouslySetInnerHTML`, `<script` and `next/script`
anywhere under `app/` and `components/` except the one JSON-LD data block. The legal texts are
portfolio samples (review checklist): the repository has no real data controller, contact channel or
production environment.

## Decision

1. **No MDX dependency.** The content files use the `.mdx` extension but only the Markdown subset
   the five articles and two legal texts need: front matter, `##` and `###` headings, paragraphs,
   bullet and numbered lists, one-line quotes, tables, links, bold and code spans. A small parser
   (`lib/content/markdown.ts`) turns the body into plain data and
   `components/content/markdown-view.tsx` renders that data as React elements. No HTML string is
   built or injected, so the guards stay unchanged and no dependency, lockfile or workspace change
   is needed. The parser throws on anything else (JSX, imports, expressions, raw HTML, `#` headings,
   `javascript:` or `http:` or protocol-relative links, malformed tables); `tests/content` loads
   every file, so a file outside the subset fails the build gate instead of rendering unreviewed.
   If a later article needs components, the choice is revisited with an MDX compiler that emits
   elements at build time.
2. **Loader.** `lib/content/documents.ts` reads `content/<collection>/*.mdx` once per process,
   validates the front matter with a strict schema (title, description of at most 155 characters,
   `publishedAt`, optional `modifiedAt`, `tags`, `sample`) and computes the word count and the
   reading time (200 words per minute, at least one minute). A request slug is only looked up in the
   loaded list and never joined into a path. The files are read at run time, so
   `outputFileTracingIncludes` in `next.config.ts` copies them into the standalone output (checked
   in the build output).
3. **Blog routes.** `app/(marketing)/blog/page.tsx` lists the articles newest first with date and
   reading time; `blog/[slug]/page.tsx` renders one article with breadcrumb links, date, reading
   time, a link to `/ozellikler` and links to the other articles. No `generateStaticParams`: the
   pages render per request (ADR-0055 build test). An unknown slug is a 404 through the root
   not-found page. Titles stay within 60 characters with the brand and descriptions within 155
   (spec §7); `og:type` is `article` with the dates.
4. **Legal routes.** `/gizlilik` and `/kvkk-aydinlatma` render the legal files; the route
   `/kvkk-aydinlatma` is the path the surface table (ADR-0055) and the spec already list, and the
   texts link to it. `/iletisim` is a short page written for the portfolio case: it says that no
   channel or controller is defined, links the existing pages and invents no address. The
   `/hesap-silme` page already exists in the `app` surface (ADR-0040). Every legal page and the
   contact page show a visible `role="note"` sample notice above the text: Kadro is a portfolio
   project and the page is not a real legal text. The pages stay indexable (the checklist asks for
   the notice, not for `noindex`).
5. **Structured data.** All blocks go through the one helper of ADR-0055 decision 6. Home and
   `/ozellikler` carry `Organization` and `MobileApplication` (`SportsApplication`, `iOS, Android`,
   a free offer); no logo, rating, store URL or Pro price is stated because none exists or the
   stores set it. The blog index carries `BreadcrumbList`, `Blog` and `Organization`; an article
   carries `BreadcrumbList`, `Article` (headline, description, dates, canonical URL, language,
   keywords, word count) and `Organization`. No `image` is given: the site has no Open Graph image
   route yet (ADR-0056).
6. **Navigation and sitemap.** The header lists Blog; the footer lists Blog, account deletion, the
   two legal pages (labelled as samples) and the contact page. `app/sitemap.ts` adds a block with the
   blog index, the articles (`lastmod` from the front matter) and the legal and contact pages.
7. **Out of scope.** `/hakkinda` and `/sss`, article images, a feed, tag pages, an `en` alternate
   and the real legal texts (the checklist's return path to a real launch).

## Consequences

- Adding an article means one `.mdx` file in the subset; the route, sitemap entry and structured
  data follow from the front matter.
- The legal texts show source paths (for example `kadro/docs/adr/...`) in code spans, as written in
  the merged content. They are sample texts and the paths are part of their review trail; a real
  launch replaces them (checklist return path).
- The quality suites audit the blog index, an article and both legal pages, and check the new
  structured data on the marketing pages; the Lighthouse run lists the blog index.
