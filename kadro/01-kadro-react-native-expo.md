# KADRO — Product Specification
**Stack:** React Native (Expo) · Next.js (web + API) · PostgreSQL · pg-boss worker
**Product:** Halı saha match organizer — build your squad, fill missing players, split the pitch fee.
**Owner:** Ayberk (`ayberkaarda/kadro`) · **Specification version:** 1.0 · **Language rule:** code, identifiers, commits, docs = English; all user-facing product copy = Turkish (tr-TR primary, en secondary).

---

## 0. Operating Contract (read before any action)

1. **Phase-gated delivery.** Work strictly in the phases of §10. At the end of every phase: **STOP and REPORT** using the template in §11, then wait for Ayberk's explicit `devam` before starting the next phase. Never start Phase N+1 on your own.
2. **No silent scope expansion.** Anything not listed in §3 (MVP) is out of scope. If you believe something is missing, list it under "Open questions / proposals" in the report — do not build it.
3. **No git operations without explicit approval.** Do not run `git add/commit/push/rebase/filter-repo/tag`. Write files only. Propose Conventional Commit messages in each report (`feat(api): ...`, `fix(mobile): ...`, `chore(ci): ...`); Ayberk executes or approves them.
4. **No placeholders.** No `TODO`, `FIXME`, `lorem ipsum`, `YOUR_KEY_HERE`, fake data pretending to be real, or stubbed functions that return canned values. Every file you create must be complete and runnable for its phase. Example values in `.env.example` are documented dummies (e.g. `DATABASE_URL=postgres://kadro:kadro@localhost:5432/kadro`) — that is allowed; secrets in code are not.
5. **Work areas have exclusive owners** (§9). An owner never edits a path outside their ownership. Cross-boundary needs go through a handoff note in `docs/handoffs/`.
6. **Do not fabricate real-world data.** Venues (halı sahalar) are seeded only as clearly labeled sample rows (`is_sample = true`, name prefixed `[ÖRNEK]`). Real venues enter through the admin import CSV in production.
7. **Decide, then record.** When a choice is needed inside the defined scope, make the engineering decision, implement it, and log it in `docs/adr/` (one ADR per decision, numbered). Ask Ayberk only when a decision changes scope, cost, or legal exposure.
8. **Versions.** Use the latest stable release of every dependency at scaffold time, pin exact versions in lockfiles, and record the resolved versions in `docs/adr/0001-stack-and-versions.md`.

---

## 1. Mind Map

```mermaid
mindmap
  root((KADRO))
    Identity
      Name Kadro
      Tagline Kadron eksik kalmasin
      Palette cim yesili + turuncu top
      Type Sora + Inter
      Domain kadro.app
    Product MVP
      Auth email+password, Apple, Google
      Teams roles kaptan/oyuncu
      Matches RSVP, lineup, reminders
      Eksik Var open calls by district
      Saha Rehberi venue directory
      Fee split status tracking
      Kadro Pro subscription
    Architecture
      apps/mobile Expo
      apps/web Next.js marketing + API
      apps/worker pg-boss
      packages/contracts zod
      packages/db Drizzle
      PostgreSQL, Cloudflare R2, Expo Push
    Security 23
      Secrets & history
      AuthZ matrix server-side
      Rate limits & validation
      Uploads, CORS, headers, HTTPS
      Argon2id, cookies, tokens
      Errors, logs, SQL, XSS
      RevenueCat webhook
      Admin RBAC + TOTP
      Audit deps, backups
      Real deletion, cost alerts
      Attack suite
    SEO & GEO
      Programmatic venue pages
      Invite landing + deep links
      JSON-LD, sitemap, hreflang
      llms.txt, answer-first copy
      ASO tr/en
    Quality
      TS strict, Vitest, Playwright, Maestro
      GitHub Actions gates
      Sentry scrubbed
    Delivery
      Phase 0 foundation
      Phase 1 auth + security core
      Phase 2 domain API + worker
      Phase 3 mobile app
      Phase 4 web SEO/GEO
      Phase 5 Pro + webhook + admin
      Phase 6 hardening + release
    Work areas
      lead
      api
      mobile
      web
      security
      qa
```

Every top-level branch above is a section below. The document is the mind map, expanded.

---

## 2. Corporate Identity (decided — do not re-brainstorm)

| Element | Decision |
|---|---|
| Name | **Kadro** ("squad/lineup") |
| Tagline (tr) | **Kadron eksik kalmasın.** |
| Positioning | Halı saha maçlarını organize eden, eksik oyuncuyu mahalleden bulan, saha ücretini takip eden uygulama. |
| Audience | 18–40 amateur players; the "organizatör" who books the pitch; teams in İstanbul, Ankara, İzmir first |
| Legal name (placeholder-free, use as-is) | Kadro Teknoloji |
| Domain | `kadro.app` (HSTS-preloaded TLD — HTTPS is mandatory by design) |
| Bundle / application id | `app.kadro.mobile` (iOS + Android) |
| Store title | **Kadro: Halı Saha & Eksik Oyuncu** |
| Palette | Çim Yeşili `#1B7F4B` (primary) · Gece Maçı `#0E1A14` (dark surface) · Kireç Beyazı `#F4F6F0` (light surface) · Turuncu Top `#FF6B1A` (accent/CTA) · Kart Sarısı `#F2C230` (warning) · Kırmızı Kart `#D7263D` (danger) · Nötr `#5B6B62` (muted text) |
| Typography | Display: **Sora** (600/700) · Body/UI: **Inter** (400/500/600) · Numerals: Inter with `tabular-nums` for scores/fees. Self-hosted in web; bundled via `expo-font` in mobile. |
| Logo concept | Wordmark `KADRO` in Sora 700; the `O` is a pitch centre circle with a centre spot. App icon: white centre circle on Çim Yeşili, Turuncu Top centre spot. Deliver as SVG in `packages/brand/`. |
| Tone of voice | Energetic, short imperatives, friendly "sen": "Kadroyu kur", "Eksik var!", "Maç 21:00'de, geliyor musun?". Never toxic-competitive. |
| Design tokens | `packages/brand/tokens.json` (colors, spacing 4-pt grid, radii 8/12/20, type scale) consumed by both mobile (NativeWind or StyleSheet theme) and web (Tailwind config). |

---

## 3. Product Scope (MVP) and Non-Goals

### Personas
- **Organizatör (captain):** creates team, books pitch offline, creates matches, tracks who paid.
- **Oyuncu (player):** RSVPs, sees lineup, pays share, votes MVP.
- **Serbest oyuncu:** no team; answers "Eksik Var" calls in their district.

### MVP user stories (all must ship)
1. Register/login with email + password (email verification), Sign in with Apple, Google Sign-In. Password reset by email.
2. Create a team (`Kadro`): name, district (il/ilçe), badge upload, invite link + QR. Roles: `captain`, `co_captain`, `player`.
3. Create a match: venue (from directory or free text), datetime, format (5v5/6v6/7v7/8v8), total pitch fee (kuruş as integer), player slots. Players RSVP `in | out | maybe`. Waitlist auto-promotes.
4. Lineup: captain drags players into two sides; auto-balance by declared position (`GK/DEF/MID/FWD`).
5. Fee split: per-player share computed from confirmed players; captain marks `paid/unpaid`; no money moves inside the app.
6. **Eksik Var:** captain publishes an open call (match, missing count, position, level `casual/regular/competitive`, district). Free players browse list/map and apply; captain accepts → player joins the match.
7. **Saha Rehberi:** venue directory (name, il/ilçe, geo point, indoor/outdoor, features, price range, phone) with user ratings 1–5 and short reviews; admin-verified badge.
8. Reminders: push at T-24h and T-2h; RSVP change notifications to captain; open-call application notifications.
9. Post-match: MVP vote (24h window), simple stats (matches played, MVP count) on profile.
10. **Kadro Pro** (RevenueCat, monthly/yearly): unlimited teams (free: 1 team owned), lineup history, advanced stats, no "Pro" upsell banners. Entitlement enforced server-side.
11. Account deletion in-app and on web (`/hesap-silme`).
12. Web: marketing site, programmatic venue pages, public open-call listings, invite landing pages with deep links.

### Non-goals (explicitly out of MVP — do not build)
- In-app payments between players (no fintech/EMI licence), venue booking integration, live chat, video, ads, leagues/tournaments, Android Wear / watchOS, multi-language beyond tr/en.

---

## 4. Architecture

### Monorepo (pnpm workspaces + Turborepo)
```
kadro/
  apps/mobile/        Expo (Expo Router, TypeScript strict)
  apps/web/           Next.js App Router: marketing + SEO pages + REST API (Route Handlers under app/api/v1)
  apps/worker/        Node service: pg-boss jobs (reminders, push fan-out, deletion, backups verify)
  packages/contracts/ zod schemas + inferred TS types + OpenAPI 3.1 generation (single source of truth)
  packages/db/        Drizzle ORM schema, migrations (drizzle-kit), seed scripts
  packages/auth/      policies (authorization matrix), token utilities, Argon2id helpers
  packages/brand/     tokens.json, logo SVGs, font files
  packages/config/    env schema (zod) — the only place process.env is read
  docs/adr/  docs/security/  docs/ops/  docs/handoffs/  docs/seo/
  .github/workflows/
```

### Mobile (`apps/mobile`)
- Expo (managed workflow, EAS Build), Expo Router (typed routes), TypeScript strict, TanStack Query (server state), Zustand (UI state), react-hook-form + zod (from `packages/contracts`), `expo-secure-store` (tokens), `expo-notifications` (push), `expo-location` + `react-native-maps` (Eksik Var map, venue map), `expo-image` (cached images), `@shopify/flash-list`, `expo-font` (Sora/Inter), `react-native-purchases` (RevenueCat), `expo-auth-session`/`expo-apple-authentication`, `expo-updates` with code signing enabled, i18next (tr default, en).
- No secrets in the binary: only `EXPO_PUBLIC_API_URL` and the RevenueCat **public** SDK key. Everything else lives server-side or in EAS Secrets (build-time, non-public values only).

### Web + API (`apps/web`)
- Next.js App Router with React Server Components for marketing/SEO; Route Handlers under `app/api/v1/**` form the REST API consumed by mobile and web.
- Auth: email/password (Argon2id), Sign in with Apple (verify identity token via Apple JWKS, nonce-bound), Google (verify ID token via Google JWKS). Mobile clients: access JWT (ES256, 15 min) + opaque refresh token (30 days, rotated, hashed at rest). Web clients: `__Host-kadro_session` cookie (HttpOnly, Secure, SameSite=Lax) with CSRF double-submit for mutations.
- Drizzle ORM on PostgreSQL 16; Redis is **not** required — rate limiting and jobs use PostgreSQL (pg-boss, `rate_limit_buckets` table with sliding window).
- Object storage: Cloudflare R2 (S3 API) for team badges/avatars via presigned PUT.
- Email: Resend (transactional: verification, reset, deletion confirmation) with templates in `apps/web/emails/`.
- Push: Expo Push API from the worker; receipts checked; invalid tokens pruned.

### Worker (`apps/worker`)
- pg-boss queues: `match.reminder`, `push.send`, `email.send`, `account.hard_delete`, `webhook.revenuecat.process`, `backup.verify`, `venue.import`. Idempotent handlers keyed by job data hash.

### Infrastructure (documented in `docs/ops/`)
- Vercel (web+API) or Docker on a VPS behind Caddy — choose one in ADR-0002 and implement `Dockerfile` + `docker-compose.yml` for local dev regardless (Postgres 16, worker, web).
- Environments: `local`, `preview`, `production`. `.env.example` lists every variable with a documented dummy value; `packages/config` validates at boot and fails fast on missing values.

---

## 5. Data Model and API Surface

### Tables (Drizzle, snake_case, `id` = UUIDv7, timestamps `created_at/updated_at`, soft-lock fields only where noted)
`users` (email unique, email_verified_at, password_hash nullable, apple_sub, google_sub, display_name, avatar_key, position, level, district_id, role `user|moderator|admin`, totp_secret_enc nullable, deactivated_at) · `refresh_tokens` (token_hash, user_id, device_label, expires_at, rotated_from, revoked_at) · `email_tokens` (purpose `verify|reset`, token_hash, expires_at, used_at) · `districts` (il, ilce, slug, centroid) · `teams` (name, slug, badge_key, district_id, owner_id, is_pro_locked) · `team_members` (team_id, user_id, role, joined_at; unique) · `team_invites` (team_id, code, expires_at, max_uses, uses) · `venues` (name, slug, district_id, point geography, address, phone, indoor, features jsonb, price_min_minor, price_max_minor, verified, is_sample, created_by) · `venue_reviews` (venue_id, user_id, rating, text; unique per user) · `matches` (team_id, venue_id nullable, venue_text, starts_at, format, fee_total_minor, slots, status `draft|open|locked|played|cancelled`, mvp_vote_closes_at) · `match_rsvps` (match_id, user_id, status `in|out|maybe|waitlist`, side `A|B|null`, paid boolean; unique) · `open_calls` (match_id, missing_count, position, level, district_id, status, expires_at) · `open_call_applications` (open_call_id, user_id, message, status) · `mvp_votes` (match_id, voter_id, votee_id; unique voter) · `push_tokens` (user_id, expo_token unique, platform, last_seen_at) · `subscriptions` (user_id, rc_app_user_id, product_id, status, expires_at, environment) · `webhook_events` (provider, event_id unique, received_at, processed_at, payload_hash) · `rate_limit_buckets` (key, window_start, count) · `audit_logs` (actor_id, action, target_type, target_id, ip_hash, metadata jsonb) · `deletion_requests` (user_id, requested_at, grace_until, completed_at) · `jobs` (pg-boss managed).

### API (all under `/api/v1`, JSON, RFC 9457 problem responses)
`POST auth/register · POST auth/login · POST auth/refresh · POST auth/logout · POST auth/verify-email · POST auth/forgot · POST auth/reset · POST auth/apple · POST auth/google · GET me · PATCH me · DELETE me (starts deletion) · POST me/push-tokens`
`GET|POST teams · GET|PATCH|DELETE teams/:id · POST teams/:id/invites · POST invites/:code/accept · PATCH teams/:id/members/:userId · DELETE teams/:id/members/:userId`
`GET|POST teams/:id/matches · GET|PATCH|DELETE matches/:id · PUT matches/:id/rsvp · PUT matches/:id/lineup · PATCH matches/:id/payments/:userId · POST matches/:id/mvp-vote`
`GET open-calls?district=&level=&position= · POST matches/:id/open-call · POST open-calls/:id/applications · PATCH open-calls/:id/applications/:appId`
`GET venues?district=&q= · GET venues/:slug · POST venues (creates unverified) · POST venues/:id/reviews`
`POST uploads/presign (kind=avatar|badge)`
`POST webhooks/revenuecat`
`GET admin/** (role admin|moderator + TOTP step-up)`
OpenAPI 3.1 is generated from `packages/contracts` at build time to `docs/api/openapi.json` and used by ZAP and by contract tests.

---

## 6. Security — the 23-item checklist, mapped to this stack

Each item lists **Impl** (what to build) and **Verify** (the proof the report must contain). The final report includes the verification matrix (§12).

1. **Anahtarları çıkar — no secrets in code.** Impl: `packages/config/env.ts` (zod) is the only reader of `process.env`; `.env*` gitignored except `.env.example`; mobile ships only `EXPO_PUBLIC_*` public values; EAS Secrets for build-time values; `gitleaks` pre-commit hook (`lefthook`) + CI job. Verify: `gitleaks detect --no-git` clean; grep for `sk_`, `BEGIN PRIVATE KEY`, `AKIA` in repo returns nothing.
2. **.env'i geçmişten sil — purge history + rotate.** Impl: CI `gitleaks detect` over full history; write `docs/security/history-purge-runbook.md` with the exact `git filter-repo --invert-paths --path .env --path .env.local` procedure, force-push warning, and the rotation list (DB password, JWT signing key, R2 keys, Resend key, RevenueCat webhook secret). Verify: runbook exists; **do not execute** — it is a git operation requiring Ayberk's approval.
3. **İzin kurallarını yaz — explicit authorization policy.** Impl: `packages/auth/policies.ts` exporting `can(actor, action, resource)` with a declarative matrix (actions: `team.update`, `team.delete`, `member.remove`, `match.create`, `match.update`, `lineup.set`, `payment.mark`, `opencall.publish`, `application.decide`, `venue.verify`, `review.delete`, `admin.*`; roles: `guest, player, co_captain, captain, moderator, admin`; ownership predicates). Mirror in `docs/security/authorization-matrix.md`. Verify: unit tests cover every cell of the matrix (table-driven).
4. **Yetkiyi sunucuda tut — enforce server-side.** Impl: every Route Handler calls `authorize()` before touching data; queries are scoped by membership joins, never by client-provided `teamId` alone; mobile only hides UI. Verify: IDOR test suite (user A vs team/match/venue review of user B → 403/404) in `apps/web/tests/security/idor.test.ts`.
5. **Girişe sınır koy — rate-limit auth.** Impl: sliding window on `auth/login|register|forgot|reset|verify-email|apple|google`: 5 per 15 min per IP **and** per email; progressive delay after 3 failures; `Retry-After` header; keys stored in `rate_limit_buckets`; IP taken from the trusted proxy header only (configured list, never raw `X-Forwarded-For`). Verify: test hits 6th request → 429; header spoof does not bypass.
6. **Girdiyi doğrula — validate all input.** Impl: zod `.strict()` schemas from `packages/contracts` on body/query/params in every handler; JSON body limit 1 MB; enum/length/range constraints (e.g. `fee_total_minor` 0..1_000_000_00, `slots` 2..30, `display_name` 2..40 chars, district must exist). Verify: fuzz tests with unknown keys, oversized strings, wrong types → 400 with problem details.
7. **Yüklemeyi sınırla — limit uploads.** Impl: only `avatar` and `badge`; presigned R2 PUT with `Content-Length` 1..2 MB and `Content-Type` in `image/jpeg|png|webp`; worker post-processes with `sharp` (re-encode to WebP, max 1024 px, strip EXIF), rejects non-images by magic bytes; per-user quota 10 uploads/day. Verify: uploading a renamed `.exe` is rejected; 3 MB file rejected at presign.
8. **CORS'u kilitle.** Impl: API responds to browsers only from `https://kadro.app`, `https://www.kadro.app`, and `http://localhost:3000` in `local`; `Vary: Origin`; no wildcard; credentials allowed only for the web origin; mobile (no `Origin`) unaffected. Verify: request with `Origin: https://evil.example` has no `Access-Control-Allow-Origin`.
9. **Güvenlik başlıkları.** Impl: `next.config.ts` `headers()` + `middleware.ts` nonce-based CSP (`script-src 'self' 'nonce-…' 'strict-dynamic'`, `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`), `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=(self)`; API responses `Cache-Control: no-store`. Verify: Mozilla Observatory-style check script in `scripts/security/headers-check.ts` returns all present.
10. **HTTPS zorunlu.** Impl: `.app` TLD is HSTS-preloaded; edge redirects http→https; Expo Android `network_security_config.xml` with `cleartextTrafficPermitted="false"` via `expo-build-properties`; iOS ATS defaults untouched; `EXPO_PUBLIC_API_URL` must start with `https://` in non-local builds (validated). Verify: build config assertion test.
11. **Şifreleri hash'le.** Impl: `@node-rs/argon2` Argon2id (memoryCost 65536 KiB, timeCost 3, parallelism 1), constant-time verify, password rule min 10 chars + HIBP k-anonymity check at registration; refresh/email tokens stored as SHA-256 hashes. Verify: DB dump shows only `$argon2id$` hashes; login timing test constant.
12. **Çerezi güvenli yap.** Impl: web `__Host-kadro_session` (HttpOnly, Secure, SameSite=Lax, Path=/, 7-day rolling) + CSRF token cookie/header double-submit; mobile stores tokens in `expo-secure-store` only (never AsyncStorage); refresh rotation with reuse detection (revoke family). Verify: cookie attributes asserted in Playwright; reuse of a rotated refresh token revokes the family (test).
13. **Hata mesajını kıs.** Impl: `ApiError` → RFC 9457 body `{type,title,status,code,requestId}`; no stack traces, SQL, or file paths in responses; `app/error.tsx` and `global-error.tsx` generic; mobile maps `code` → Turkish copy in `i18n/tr/errors.json`. Verify: forced 500 returns generic body with `requestId` only.
14. **Logları temizle.** Impl: `pino` with `redact` for `req.headers.authorization`, `req.headers.cookie`, `*.password`, `*.token`, `*.refreshToken`, `*.email` (masked to `a***@d***`); no request bodies at `info`; request IDs propagated; retention 30 days (documented); Sentry `beforeSend` scrubs the same fields on web and mobile. Verify: log sample from a login flow contains no email/password/token.
15. **Sorguyu parametrele.** Impl: Drizzle query builder everywhere; `sql` template only with bound params; ESLint rule (`no-restricted-syntax`) bans `sql.raw` with template concatenation; migrations are files, not runtime strings. Verify: grep for `sql.raw(` shows only reviewed, parameter-free DDL.
16. **XSS'e karşı kaçır.** Impl: React escaping by default; ESLint `react/no-danger` = error; markdown (match notes, venue reviews) rendered through `remark` + `rehype-sanitize` with a strict schema; CSP nonce; mobile renders text only, no WebView with user content. Verify: stored payload `<img src=x onerror=alert(1)>` renders as text on web and mobile.
17. **Webhook imzası.** Impl: `POST /api/v1/webhooks/revenuecat` reads the raw body, checks the `Authorization` header against `REVENUECAT_WEBHOOK_SECRET` using `crypto.timingSafeEqual`, rejects if `event.app_user_id` is unknown, stores `event.id` in `webhook_events` (unique → replay-safe), returns 200 within 2 s and enqueues `webhook.revenuecat.process`; entitlements are additionally reconciled nightly via the RevenueCat REST API. Verify: tests for missing header, wrong secret, replayed event id, unknown user.
18. **Admin'e rol koy.** Impl: `role` on `users`; `/admin/**` (web) and `/api/v1/admin/**` require `moderator|admin` **and** a TOTP step-up (`otplib`, secret encrypted with AES-256-GCM key from env) valid for 15 min; every admin action writes `audit_logs`; moderators: verify venues, remove reviews/open calls; admins: manage roles. Verify: player hitting admin route → 403; admin without TOTP → 401 step-up; audit row created.
19. **Paketleri denetle.** Impl: `pnpm audit --audit-level=high` fails CI; `renovate.json` (weekly, grouped minor, immediate security); `pnpm dedupe --check`; `npx expo-doctor`; lockfile committed; `syncpack` alignment. Verify: CI workflow file + passing run description.
20. **Otomatik yedek.** Impl: `apps/worker` job `backup.verify` + `scripts/ops/backup.sh` (`pg_dump -Fc` daily to R2 bucket `kadro-backups` with 30-day lifecycle, AES-256 via `age` before upload) and, if managed Postgres is chosen in ADR-0002, PITR enabled and documented; R2 object versioning on uploads bucket; `docs/ops/backup-restore.md` runbook; CI job `restore-drill.yml` (weekly) restores latest dump into a Postgres container and runs smoke queries. Verify: drill workflow output.
21. **Hesabı gerçekten sil.** Impl: in-app `Ayarlar → Hesabımı sil` (Apple 5.1.1(v)) and web `/hesap-silme` (Google policy): re-auth → immediate deactivation (all refresh tokens revoked, push tokens deleted, RevenueCat subscriber deleted via API) → 7-day grace (login cancels) → worker `account.hard_delete`: delete PII rows, R2 objects, invites; anonymize historical `match_rsvps`/`mvp_votes` to `deleted_user` sentinel so team history stays consistent; teams owned solo are deleted, shared teams transfer captaincy to oldest co-captain or member; `deletion_requests.completed_at` set; confirmation email; `audit_logs` row without PII. Verify: end-to-end test proves no row references the user's email/name after completion.
22. **Harcama uyarısı kur.** Impl: `docs/ops/cost-alerts.md` with concrete thresholds and where to set them (hosting spend limit, Postgres compute/storage, R2 storage + egress, Resend monthly volume, RevenueCat MTR tier, Sentry quota) plus application kill-switches: push fan-out max 5 000 sends/hour, presign max 10/user/day, open-call push radius cap. Worker job `cost.guard` counts daily outbound emails/pushes and pauses non-critical sends above configured caps. Verify: doc + `cost.guard` tests.
23. **Saldırgan gibi dene.** Impl: `docs/security/threat-model.md` (STRIDE per feature: auth, teams, matches, open calls, uploads, webhook, admin, deletion); `scripts/security/attack-suite.ts` (Vitest, runs against local stack): IDOR matrix, rate-limit bypass via spoofed headers, JWT `alg:none`/wrong key, expired/rotated refresh reuse, oversized JSON, MIME spoofing on upload, CORS probe, webhook forgery/replay, CSRF on web mutation without token, admin without TOTP, deletion grace bypass; OWASP ZAP baseline + API scan (`docs/api/openapi.json`) in CI against the preview URL; MobSF static scan of the release APK/IPA (documented steps + findings); `expo-updates` code signing verified. Verify: `docs/security/pentest-report.md` listing each finding, severity, fix commit proposal, retest result.

---

## 7. SEO and GEO (web = `apps/web`)

### Information architecture (Turkish slugs)
`/` · `/ozellikler` · `/eksik-var/[il]/[ilce]` (public open calls, ISR 5 min, list pages indexable, expired calls removed) · `/sahalar/[il]` · `/sahalar/[il]/[ilce]` · `/saha/[slug]` (venue page: map, features, price range, reviews, "Bu sahada maç kur" CTA) · `/mac/[inviteCode]` (invite landing, `noindex`, Smart App Banner + deep link `kadro://match/[code]`) · `/blog/[slug]` (MDX: "Halı sahada 7v7 diziliş", "Kadro nasıl kurulur", "Halı saha ücreti nasıl bölünür") · `/hakkinda` · `/sss` · `/gizlilik` · `/kvkk-aydinlatma` · `/hesap-silme` · `/iletisim`.

### Technical SEO
- Server-rendered (RSC) content, no client-only text; `generateMetadata` per route (title ≤ 60 chars, description ≤ 155, Turkish); canonical URLs; `hreflang` `tr-TR` + `en` + `x-default`; `app/sitemap.ts` (chunked, includes venues/districts/blog) and `app/robots.ts`; OG/Twitter images via `next/og` using brand tokens; JSON-LD: `Organization`, `MobileApplication` (operatingSystem iOS/Android, `applicationCategory: SportsApplication`, `offers` free + Pro), `SportsActivityLocation` for venues (with `aggregateRating` only when ≥ 3 real reviews), `BreadcrumbList`, `FAQPage` on `/sss`, `Article` on blog; Core Web Vitals budgets (LCP < 2.5 s, INP < 200 ms, CLS < 0.1) enforced by Lighthouse CI; `next/image`, self-hosted fonts with `font-display: swap`.
- App linking: `/.well-known/apple-app-site-association` (paths `/mac/*`, `/saha/*`, `/eksik-var/*`), `/.well-known/assetlinks.json`, `apple-itunes-app` meta with `app-argument`; Expo `scheme: "kadro"` + `associatedDomains` + `intentFilters` configured in `app.config.ts`.

### GEO (Generative Engine Optimization)
- `public/llms.txt` (what Kadro is, who it is for, feature list, pricing, links to key pages) and `public/llms-full.txt` (extended, plain text).
- Every page opens with a 40–60 word answer-first paragraph that defines the entity ("Kadro, halı saha maçı organize etmek…"). `/sss` holds 15 Turkish Q&A pairs mirrored in `FAQPage` JSON-LD. Consistent brand facts (name, founded year from ADR, category, platforms) across `/hakkinda`, `llms.txt`, JSON-LD.
- Honest `dateModified`; no hidden text; semantic HTML (`<article>`, `<section>`, headings in order); venue and district pages include structured facts lists that generative engines can quote.

### ASO (documented in `docs/seo/aso.md`)
Title "Kadro: Halı Saha & Eksik Oyuncu"; subtitle "Kadroyu kur, eksiği bul"; keyword set (tr): halı saha, eksik oyuncu, maç organize, kadro kur, halısaha, futbol takımı, maç bul, oyuncu bul; en set secondary; screenshot storyboard (6 frames) with Turkish captions; privacy labels must match implementation (location: used for Eksik Var; contacts: not collected).

---

## 8. Quality, Testing, CI, Observability

- TypeScript `strict`, `noUncheckedIndexedAccess`; ESLint (typescript-eslint, `eslint-plugin-security`, `react/no-danger`), Prettier; commit message lint (`commitlint`, conventional) — as a hook definition only, git usage stays with Ayberk.
- Tests: Vitest (unit + API integration against a Postgres test container), Playwright (web e2e: register, create team, invite landing, deletion page, headers/cookies assertions), Maestro flows in `apps/mobile/.maestro/` (login, create match, RSVP, open call apply, delete account), MSW for mobile component tests, contract tests validating handlers against the generated OpenAPI.
- CI (`.github/workflows/ci.yml`): install → lint → typecheck → unit/integration → build web → `pnpm audit` → `gitleaks` → Lighthouse CI (preview) → ZAP baseline (preview). `mobile-build.yml` runs EAS build on manual dispatch only.
- Observability: Sentry (web, worker, mobile) with scrubbing; structured logs with request IDs; worker job metrics logged; uptime check on `/api/v1/health` (returns build SHA, no secrets).
- Accessibility: RN `accessibilityLabel/Role`, dynamic type, contrast ≥ 4.5:1 with the palette; web axe checks in Playwright.
- i18n: `i18next` namespaces `common, auth, teams, matches, opencalls, venues, errors`; Turkish strings authored first.

---

## 9. Work Ownership and Repository Conventions

Work in parallel only when ownership sets are disjoint.

| Owner | Owns (exclusive write) | Reads |
|---|---|---|
| `lead` | `packages/contracts/**`, `packages/config/**`, `packages/brand/**`, `docs/adr/**`, `docs/handoffs/**`, root configs, `CONTRIBUTING.md` | everything |
| `api` | `apps/web/app/api/**`, `apps/web/lib/server/**`, `packages/db/**`, `packages/auth/**`, `apps/worker/**`, `apps/web/emails/**` | contracts, ADRs |
| `mobile` | `apps/mobile/**` | contracts, brand |
| `web` | `apps/web/app/(marketing)/**`, `apps/web/app/(seo)/**`, `apps/web/content/**`, `apps/web/components/**`, `apps/web/public/**`, `docs/seo/**` | contracts, brand |
| `security` | `docs/security/**`, `scripts/security/**`, `.github/workflows/security.yml`, `apps/web/tests/security/**` | everything (read-only elsewhere) |
| `qa` | `apps/web/tests/e2e/**`, `apps/mobile/.maestro/**`, `.github/workflows/ci.yml` | everything |

Rules: a needed change in another owner's area → write `docs/handoffs/<from>-to-<to>-<NNN>.md` (what, why, acceptance) and let the owner implement. Shared contract changes are proposed to `lead`, who edits `packages/contracts` and bumps `docs/api/openapi.json`. Git operations follow the approval rule in §0.

---

## 10. Delivery Phases and Gates

Each phase ends with **STOP → REPORT (§11) → wait for `devam`**.

**Phase 0 — Foundation.** Monorepo scaffold, tooling, `CONTRIBUTING.md` (§13), `docs/adr/0001-stack-and-versions.md`, `0002-hosting.md`, `packages/brand` (tokens, logo SVG, fonts), `packages/config` env schema + `.env.example`, `docker-compose.yml` (Postgres 16, web, worker), CI skeleton (lint/typecheck), `docs/security/authorization-matrix.md` draft, `docs/security/threat-model.md` outline. Gate: `pnpm install && pnpm build` succeeds; ADRs written.

**Phase 1 — Data, auth, security core (items 1, 3–6, 8–15).** Drizzle schema + migrations + seed (districts of İstanbul/Ankara/İzmir; `[ÖRNEK]` venues), auth endpoints (email, Apple, Google, refresh rotation), sessions/cookies, rate limiting, validation layer, headers/CORS/CSP, error + log infrastructure, policies module with matrix tests, IDOR test harness. Gate: all Phase 1 tests green; verification notes for each covered item.

**Phase 2 — Domain API + worker (items 7, 21 partial).** Teams, invites, matches, RSVP, lineup, payments marking, open calls, applications, venues, reviews, uploads (presign + post-process), push tokens, worker jobs (reminders, push, email), deletion request flow (start/cancel; hard delete job). Gate: OpenAPI generated; integration tests; worker jobs demonstrated locally.

**Phase 3 — Mobile app.** Expo scaffold, design system from tokens, navigation, auth screens, teams, matches (RSVP/lineup/payments), Eksik Var list + map, Saha Rehberi, profile + stats, settings (deletion), push handling, offline-tolerant query cache, deep links. Gate: Maestro flows pass on iOS simulator and Android emulator; `expo-doctor` clean.

**Phase 4 — Web SEO/GEO (§7).** Marketing pages, programmatic district/venue pages, invite landing, blog (5 real articles written in Turkish, ≥ 600 words each), legal pages (KVKK aydınlatma, gizlilik, hesap silme), sitemap/robots/JSON-LD/hreflang, `llms.txt`, AASA/assetlinks, Lighthouse CI budgets. Gate: Lighthouse ≥ 90 performance/SEO/accessibility on 5 sample pages; JSON-LD validates.

**Phase 5 — Kadro Pro, webhook, admin (items 17, 18).** RevenueCat products/entitlements, mobile paywall (tr copy), server entitlement checks, webhook endpoint + processing + nightly reconciliation, admin area (venue verification, moderation) with TOTP step-up and audit log. Gate: webhook tests; entitlement gating tests; admin e2e.

**Phase 6 — Hardening and release readiness (items 2, 19, 20, 22, 23 + matrix).** Attack suite, ZAP/MobSF runs and report, dependency audit, backup + restore drill, cost-alert doc + `cost.guard`, history-purge runbook, ASO doc, store listing copy (tr/en), privacy labels, final **23-item verification matrix** and **SEO/GEO checklist**. Gate: FINAL REPORT.

---

## 11. Report Template (use verbatim at every gate)

```
# Kadro — Phase <N> Report
## Summary (5 lines max)
## Files created / modified (grouped by owner, full paths)
## Decisions & ADRs added
## Security checklist status
| # | Item | Status (done / partial / not-started) | Evidence (test name, doc path) |
## SEO/GEO status (Phase 4+)
## Tests executed (command + result counts)
## Known gaps / risks (never hidden)
## Open questions / proposals (scope, cost, legal)
## Proposed Conventional Commits (not executed)
## Next phase preview (3 lines)
STOPPED — waiting for "devam".
```

---

## 12. Definition of Done (final)

- All 23 items **done** with evidence; SEO/GEO checklist complete; every MVP story demonstrable via Maestro/Playwright.
- No placeholder tokens (`TODO|FIXME|lorem|YOUR_`) — CI grep gate.
- `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green; `pnpm audit` high/critical = 0; `gitleaks` clean.
- Docs: ADRs, authorization matrix, threat model, pentest report, backup/restore runbook, cost alerts, ASO, store copy, KVKK texts.
- Release artefacts: EAS build profiles (`development`, `preview`, `production`), signed update channel config, web deploy config.

---

## 13. `CONTRIBUTING.md` to create in Phase 0 (content skeleton — fill completely, no placeholders)

```
# Kadro — Contributor Rules
- Language: code/docs/commits English; product copy Turkish (tr-TR), English secondary.
- Phase discipline: follow the phases in the product spec (§10); stop and report at gates; wait for "devam".
- Never run git commands. Propose Conventional Commits in reports.
- No placeholders, no fake real-world data (sample rows are [ÖRNEK]/is_sample=true).
- Ownership table (copy of spec §9). Handoffs via docs/handoffs/.
- Security: 23-item checklist is a hard requirement; verification matrix maintained in docs/security/verification-matrix.md.
- Commands: pnpm dev | pnpm test | pnpm lint | pnpm typecheck | pnpm db:migrate | pnpm db:seed | pnpm worker:dev | pnpm mobile:start
- Env: packages/config/env.ts is the only process.env reader; .env.example documents every key.
- Testing expectations per layer; CI gates; Lighthouse budgets.
- Parallel work only on disjoint ownership sets (§9).
```
