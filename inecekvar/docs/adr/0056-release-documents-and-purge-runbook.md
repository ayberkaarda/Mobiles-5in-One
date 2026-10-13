# ADR-0056: Release documents, privacy-label mapping and the history-purge runbook

- Status: Accepted (documents); the decisions listed under "Open owner decisions" stay with the owner
- Deciders: Project owner (decision delegated to the lead for the documents)
- Phase: 6, package 6F

## Context

Section 10 closes phase 6 with the history-purge runbook, the ASO document, store copy in Turkish
and English and the privacy mapping. Section 6 item 2 asks for `docs/security/history-purge-runbook.md`
(`git filter-repo` targets `.env`, `*.keystore`, `*.jks`, `*.p8`, `google-services.json`, plus a
rotation list), not executed without the owner's approval; its Done is "runbook + CI history scan".
Section 12 asks for KVKK texts, Capacitor build documents without keys, PWA deployment, Docker
images, the Caddyfile and a PMTiles build recipe. Package 4D left `docs/seo/aso.md` with an open
conflict: the specification store title has 36 characters, both stores cap the title at 30, and
section 2 forbids re-deciding the identity. No store account, host, domain or signing key exists
(ADR-0005), so the documents can only be checked against the code, not against store consoles.

## Decision

1. **Documents.** `docs/security/history-purge-runbook.md`; under `docs/release/`:
   `store-listing.tr.md`, `store-listing.en.md`, `privacy-labels.md`, `signing.md`,
   `release-checklist.md`, `pmtiles-recipe.md`, `legal-open-items.md`; `docs/seo/aso.md` finished
   and `docs/seo/checklist.md` updated. Every factual sentence names its source (code path,
   configuration or ADR). No contact data, registry data or price is written anywhere: none
   exists, and the ADR-0040 honesty rules forbid inventing them.
2. **Title.** Not decided here. Both listings keep the specification title (`title.spec`, 36)
   and three store-sized options (`title.option-a` `İnecek Var: Dolmuş & Minibüs` 28,
   `title.option-b` `İnecek Var: Dolmuş Hatları` 26, `title.option-c` `İnecek Var` 10). The PWA
   manifest and `FACTS.storeTitle` keep the 36 character form (no cap applies there).
3. **Privacy mapping method.** Start from what leaves the device: every API route the app calls,
   every package in `package.json`, the merged manifest of the release APK (MobSF `report.json`
   permissions and domain list). Follow each value into `api/app/models/`, the log policy
   (`docs/ops/logging.md`), object storage and the processors. Data that never leaves the device
   is not "collected". Each row of `privacy-labels.md` carries the Play answer (collected, shared,
   ephemeral, optional) and the Apple answer (type, linked, tracking).
4. **Runbook scope.** The repository is a monorepo: a purge rewrites every project's history,
   breaks every pull request, clone and worktree, and is the owner's decision for the whole
   repository. Rotation comes before the rewrite, in a fixed order (database, Redis, object
   storage, age backup key, JWT ES256 pair, CSRF and log hash keys, sessions, SMTP and Resend,
   RevenueCat, TOTP with the ADR-0037 key-id procedure, Sentry, store and signing credentials).
   Status line: "Not executed: needs the owner's approval".
5. **Check script.** `ops/release/check-release-docs.mjs` (not wired into CI): store field
   limits (title options at most 30, short description at most 80, subtitle 30, keywords 100,
   promotional text 170, full description 4000, what's new 500), existence of every screenshot
   path named in `docs/release/*.md` and `docs/seo/aso.md` with a ratio warning, and that every
   `INECEKVAR_*` and `IV_WEB_*` key named in the release documents and the runbook is documented
   (`docs/ops/env.md`, else ADR-0038, ADR-0039 or `ops/Caddyfile` as a warning, else failure).

## Mismatches found between the privacy labels and the code

Full table in `privacy-labels.md` section 6:

- M1, M2: the 4D draft named location only for nearby stops and recording and called the nearby
  query precise; the code sends a low-accuracy fix rounded to 3 decimals for nearby, and also uses
  location for the planner (4 decimals in `POST plan`) and for a stop position in a proposal.
- M3: the draft said Plus was not on sale; phase 5 stores purchase state and identifies every
  signed-in native user at RevenueCat with the account id.
- M4: the merged manifest adds `ACCESS_NETWORK_STATE`, `com.android.vending.BILLING` and an
  AndroidX internal permission absent from the source manifest (no new data type beyond purchases).
- M5: no web path to request account deletion (`/hesap-silme` has no form); Google Play expects one.
- M6: `share` is allowlisted (section 4, ADR-0004) but not installed; no camera plugin.
- M7: no iOS platform, so the Apple answers cannot be checked against usage strings.
- M8: RevenueCat SDK endpoints (including a diagnostics host) are in the APK; their data
  disclosure must be confirmed before a build with a key.
- M9: the client address is kept as keyed digests (up to 90 days for anonymous pack rows);
  classed as "not collected as an identifier", owner to confirm.
- M10: the optional display name was missing from the draft.
- M11: specification item 14 mentions Sentry on both apps; no app or web SDK exists.

Other findings recorded in the documents (no code changed, owners named there): the PWA host
serves no `assetlinks.json` although the Android filter auto-verifies `app.inecekvar.app`
(magic links stay unverified; the AASA components also omit `/giris/baglanti`);
`apps/mobile/android/key.properties` is not ignored; no Dockerfile and no production Caddy
configuration exist; no tool creates the first city or the first admin in production;
`environment.ts` has no per-build replacement for the RevenueCat public key; `docs/ops/cost-alerts.md`
writes the tiles cache rule for `cities/*.pmtiles` while the app and the API read
`<slug>.pmtiles` at the root of the tiles host; tilemaker's and Planetiler's default schemas do
not match the map style (Protomaps basemap layers are required); 14 web and proxy keys are
documented in ADR-0038, ADR-0039 or `ops/Caddyfile` but not in `docs/ops/env.md`; all listing
screenshots show the sample city at a 2.22 ratio.

## Open owner decisions

Store title (option a, b or c); category confirmation; screenshot retake; support contact and
contact channel; web deletion path; open-data licence approval (ADR-0003) and the contribution
licence wording (including a licence version if the text changes); KVKK text, privacy policy and
terms of use; Plus price and terms; developer account entity; any history purge
(`legal-open-items.md` L1 to L10, runbook section 3).

## Evidence

| #   | Check                                             | Command                                                                                                                                                   | Result                                                                                                                                                                                                                                                                                                                                                 |
| --- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Release docs                                      | `node ops/release/check-release-docs.mjs`                                                                                                                 | passed, 7 warnings (six screenshots at ratio 2.22, 14 keys documented outside `env.md`); tr and en title options 28, 26, 10 and 28, 25, 10 of 30; short 68 and 61 of 80; subtitle 29 and 28 of 30; keywords 89 and 59 of 100 (Turkish 100 UTF-8 bytes); full description 1772 and 1833 of 4000; 8 screenshot paths, 0 missing; 65 keys, 51 in `env.md` |
| 2   | Script mutations                                  | title option b lengthened to 37 characters, one screenshot path renamed, an unknown key appended to the checklist                                         | 2 failures, then 1 failure, exit 1; restored, passed                                                                                                                                                                                                                                                                                                   |
| 3   | Target files in history                           | `git log --all --diff-filter=A --name-only --format= -- inecekvar` filtered for `.env`, keystore, `.jks`, `.p8`, `.p12`, Firebase files, `key.properties` | only `inecekvar/.env.example` (1487 commits over all refs, 182 touch `inecekvar/`)                                                                                                                                                                                                                                                                     |
| 4   | Full-history secret scan (local, gitleaks 8.30.1) | `gitleaks git --no-banner --redact --config .gitleaks.toml --log-opts="--remotes HEAD" .` and `--log-opts="--all"`                                        | 1134 commits, no leaks; 1168 commits, 1 finding (`generic-api-key`, `kadro/apps/worker/test/backup-verify.test.ts`, commit `33361dd7`, only on the local Kadro branch `feat/rc-delete-backup`, outside Inecek Var)                                                                                                                                     |
| 5   | CI history scan on GitHub                         | `gh run view 38323508797` (Inecek Var CI, branch `feat/inecekvar-p5`, `30d82734`), job "Inecek Var checks", step "Scan history"                           | success: `1103 commits scanned.`, `no leaks found`                                                                                                                                                                                                                                                                                                     |
| 6   | Security workflow on GitHub                       | `gh run list --workflow inecekvar-security.yml`                                                                                                           | HTTP 404: the workflow is not on the default branch and this branch is not pushed; its `Gitleaks (full history)` job has never run on GitHub                                                                                                                                                                                                           |

Not exercised:

- `not exercised: the purge itself` (needs the owner's approval; no finding requires it).
- `not exercised: the store consoles` (no developer accounts): Data safety form, App Privacy
  questionnaire, content rating, listing preview.
- `not exercised: the release build, deploy and smoke steps` (no host, no signing key).
- `not exercised: a PMTiles build and a tiles host`.
