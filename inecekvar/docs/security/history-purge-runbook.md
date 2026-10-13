# Runbook: purge secrets from Git history and rotate credentials

|         |                                                                                                                                                                                                                       |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Item    | Security checklist item 2 (specification section 6.2)                                                                                                                                                                 |
| Status  | **Not executed: needs the owner's approval.** Every step that rewrites history or force-pushes needs Ayberk's explicit approval (specification section 0.3 lists `filter-repo` among the gated git operations).       |
| Trigger | a gitleaks finding in history (step `Scan history` of `.github/workflows/inecekvar-ci.yml`, job `Gitleaks (full history)` of `.github/workflows/inecekvar-security.yml`), or a target file of section 4 in any commit |
| Owner   | Repository owner. Rotation may start at once; the history rewrite waits for approval.                                                                                                                                 |
| ADR     | ADR-0056 (this runbook), ADR-0051 (history scan in CI), ADR-0037 (TOTP key rotation), ADR-0053 (backup keys)                                                                                                          |

## 1. Purpose

A secret that reached a commit is compromised as soon as the commit leaves the machine: forks,
clones, CI caches and the hosting provider's own copies keep it. This runbook says, in order, how
to rotate every credential Inecek Var uses and how to remove the files from history afterwards so
the leak stops spreading. Rotation is the fix; the rewrite only limits further copies.

No production credential exists for this project today (ADR-0005: no host, no provider accounts),
and section 3 records that no target file has ever been committed under `inecekvar/`.

## 2. The repository is a monorepo

Inecek Var lives in `inecekvar/` of the `Mobiles-5in-One` repository, next to `askida/`, `cetele/`,
`kadro/` and other projects. `git filter-repo` rewrites **every commit of the repository**, not
only the ones that touch `inecekvar/`: every commit id of every project changes from the first
rewritten commit onwards. Consequences:

- every open pull request of every project loses its base and must be recreated or rebased;
- every clone and every worktree (for example `.worktrees/inecekvar-p6`) must be discarded and
  cloned again; pushing from an old clone brings the purged objects back;
- commit ids quoted in ADRs, reports and the verification matrices of every project stop
  resolving;
- the other projects' own history-purge runbooks (`askida/docs/security/history-purge-runbook.md`,
  `cetele/docs/security/history-purge-runbook.md`, `kadro/docs/release/history-purge-runbook.md`)
  describe the same repository-wide operation; one rewrite should combine all pending targets.

A purge is therefore the **owner's decision for the whole repository**, not a decision of the
Inecek Var lane.

## 3. Preconditions and the current state

Before any rewrite:

1. The owner approves the rewrite in writing (issue or message) and names the window.
2. Rotation of section 6 is finished for every leaked value, and section 6 "Check" passed.
3. Every open pull request of every project is merged, closed or noted for recreation.
4. Collaborators are told to stop pushing until they have re-cloned.
5. `git filter-repo` is installed on the operator's machine (it is not installed on the
   development host today: `which git-filter-repo` finds nothing).

State recorded on 2026-10-13 at `e752c0f6` (branch `feat/inecekvar-p6`; 1487 commits over all
refs, 182 of them touch `inecekvar/`):

```text
$ git log --all --diff-filter=A --name-only --format= -- inecekvar | sort -u | grep -E -i "(^|/)\.env($|\.)|\.keystore$|\.jks$|\.p8$|\.p12$|google-services\.json$|GoogleService-Info\.plist$|key\.properties$"
inecekvar/.env.example

$ git log --all --oneline -- "inecekvar/**/.env" "inecekvar/.env" "*.keystore" "*.jks" "*.p8" "*google-services.json" | wc -l
0
```

The only match is `inecekvar/.env.example`, the committed file of documented dummies (specification
item 1); it stays. `inecekvar/.gitignore` ignores `.env`, `.env.*` (except the example),
`*.keystore`, `*.jks`, `*.p8`, `*.p12`, `google-services.json` and `GoogleService-Info.plist`.

Secret scan of the full history with the repository configuration, same day:

```text
$ gitleaks git --no-banner --redact --config .gitleaks.toml --log-opts="--remotes HEAD" .
1134 commits scanned.
no leaks found

$ gitleaks git --no-banner --redact --config .gitleaks.toml --log-opts="--all" .
1168 commits scanned.
leaks found: 1
```

The one `--all` finding is rule `generic-api-key` in `kadro/apps/worker/test/backup-verify.test.ts`,
commit `33361dd7`, reachable only from the local branch `feat/rc-delete-backup` (Kadro, never
pushed). It is outside Inecek Var and recorded in ADR-0051 and the item 2 row of
`verification-matrix.md`; the Kadro owner decides about that branch. The earlier Inecek Var
finding in commit `8197119d` (the public Svix documentation example in a test) is covered by a
commit-scoped allowlist entry in `.gitleaks.toml` (ADR-0051).

CI on GitHub: run `38323508797` of "Inecek Var CI" (branch `feat/inecekvar-p5`, commit
`30d82734`, 2026-10-12), job "Inecek Var checks", step "Scan history": `1103 commits scanned.`,
`no leaks found`. The separate `inecekvar-security.yml` workflow has not run on GitHub yet
(`gh run list --workflow inecekvar-security.yml` answers 404: the file is not on the default
branch and this branch is not pushed).

Conclusion: **no purge is needed today.** The rest of this runbook is the procedure for the day a
finding appears.

## 4. Targets

Inecek Var paths carry the `inecekvar/` prefix. Targets from specification item 2 plus the files
this project can actually produce:

| Target                                                    | Why it can hold a secret                                                                                 |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `inecekvar/.env`, `inecekvar/.env.*` (not `.env.example`) | Compose passwords; an operator may also put `INECEKVAR_*` API secrets there by mistake                   |
| `*.keystore`, `*.jks`                                     | Android upload key (`docs/release/signing.md`)                                                           |
| `*.p8`                                                    | Apple App Store Connect API key or other Apple signing key                                               |
| `*.p12`                                                   | iOS distribution identity                                                                                |
| `google-services.json`, `GoogleService-Info.plist`        | Firebase project files; the Android Gradle file applies the plugin when the first one exists             |
| `inecekvar/apps/mobile/android/key.properties`            | keystore passwords, if the signing wiring of `signing.md` is adopted                                     |
| `*.pem` under `inecekvar/` holding `PRIVATE KEY`          | `INECEKVAR_JWT_PRIVATE_KEY_PATH` points at a PEM file outside the repository; a copy inside it is a leak |
| an age identity file (`AGE-SECRET-KEY-` content)          | `INECEKVAR_RESTORE_AGE_IDENTITY_FILE` (ADR-0053); decrypts every database dump                           |

Files that stay: `inecekvar/.env.example`, the public test fixtures allowlisted in `.gitleaks.toml`.

## 5. Dry run on a mirror clone

Never rewrite the working clone. Work on a fresh mirror, inspect, then decide.

```sh
# 1. Fresh mirror (filter-repo refuses a clone that is not fresh; that is intended)
git clone --mirror https://github.com/ayberkaarda/Mobiles-5in-One.git purge.git
cd purge.git

# 2. Size and refs before, for the incident note
git count-objects -vH
git for-each-ref --format='%(refname)' | wc -l

# 3. Every commit that touches a target (record ids and file names, never values)
git log --all --oneline -- 'inecekvar/.env' 'inecekvar/**/.env' '*.keystore' '*.jks' '*.p8' \
  '*.p12' '*google-services.json' '*GoogleService-Info.plist' 'inecekvar/apps/mobile/android/key.properties'

# 4. Rewrite inside the mirror only
git filter-repo --invert-paths \
  --path-glob 'inecekvar/.env' \
  --path-glob 'inecekvar/**/.env' \
  --path-glob 'inecekvar/.env.local' \
  --path-glob '*.keystore' --path-glob '*.jks' --path-glob '*.p8' --path-glob '*.p12' \
  --path-glob '*google-services.json' --path-glob '*GoogleService-Info.plist' \
  --path 'inecekvar/apps/mobile/android/key.properties'

# 5. Check the mirror: the targets are gone, the example file is still there
git log --all --oneline -- 'inecekvar/.env' '*.keystore' '*.jks' '*.p8' '*google-services.json' | wc -l   # expect 0
git log --all --oneline -- inecekvar/.env.example | head -1                                            # expect a commit
gitleaks git --no-banner --redact --config .gitleaks.toml --log-opts="--all" .
```

Add `--path` lines for any other file found in step 3 (a PEM or age identity under a name not in
the list). A secret that sits inside a file that must stay (for example a key pasted into a
source file) is removed with `git filter-repo --replace-text expressions.txt`, where each line
is `literal:<the leaked value>==>REMOVED`; keep `expressions.txt` outside every repository and
delete it afterwards.

Stop after step 5 and report the counts to the owner. Nothing has been pushed at this point.

## 6. Credential rotation

Rotate first, in this order: the credentials that let an attacker read or change data come first,
then the ones that let them impersonate users, then provider-side secrets. Rotate everything the
leaked file held; when in doubt, rotate the whole list. Keys are the `INECEKVAR_*` settings of
`docs/ops/env.md`.

| #   | Credential                                    | Keys                                                                                                                                                                        | How to rotate                                                                                                                                                                                                                                                   | Check                                                                                                                                                                                                                        |
| --- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | PostgreSQL                                    | password inside `INECEKVAR_DATABASE_URL`; `INECEKVAR_DB_PASSWORD` (compose)                                                                                                 | `ALTER ROLE ... PASSWORD` with a new random value, update the URL for API, worker and Alembic, restart both                                                                                                                                                     | the old URL is refused (`psql` with it fails)                                                                                                                                                                                |
| 2   | Redis                                         | password inside `INECEKVAR_REDIS_URL`                                                                                                                                       | set the new `requirepass` / ACL user, update the URL, restart API and worker                                                                                                                                                                                    | old password refused; rate limits and planner cache work                                                                                                                                                                     |
| 3   | Object storage (Cloudflare R2, MinIO locally) | `INECEKVAR_S3_ACCESS_KEY_ID`, `INECEKVAR_S3_SECRET_ACCESS_KEY`; backup identities `INECEKVAR_BACKUP_S3_WRITE_*`, `INECEKVAR_RESTORE_S3_READ_*`, `INECEKVAR_BACKUP_VERIFY_*` | create a new token per identity with the same bucket policy, deploy, then revoke the old token                                                                                                                                                                  | an upload with the old key is refused; `backup.verify` reports `ok`                                                                                                                                                          |
| 4   | Backup encryption (age)                       | `INECEKVAR_BACKUP_AGE_RECIPIENT` (public), identity in `INECEKVAR_RESTORE_AGE_IDENTITY_FILE`                                                                                | create a new identity with `age-keygen`, set the new recipient on the backup host, run one backup, run the restore drill with the new identity; keep the old identity offline until every dump encrypted to it has expired (30 days, ADR-0053), then destroy it | the drill restores the newest dump with the new identity                                                                                                                                                                     |
| 5   | JWT ES256 key pair                            | `INECEKVAR_JWT_PRIVATE_KEY_PEM` / `_PATH`, `INECEKVAR_JWT_PUBLIC_KEY_PEM` / `_PATH`                                                                                         | create a new P-256 pair (`openssl ecparam -name prime256v1 -genkey -noout -out jwt-es256.pem`, `openssl ec -in jwt-es256.pem -pubout -out jwt-es256.pub.pem`) outside the repository, deploy both                                                               | every access token signed with the old key fails; native clients refresh (access tokens live 15 minutes)                                                                                                                     |
| 6   | CSRF and log hash keys                        | `INECEKVAR_CSRF_SECRET`, `INECEKVAR_LOG_HASH_KEY`                                                                                                                           | new random values of at least 32 characters                                                                                                                                                                                                                     | web sessions need a new CSRF token; note: a new log hash key empties the effective suppression list and changes every log digest (`docs/ops/env.md`, ADR-0050), so re-add complaint suppressions from the provider dashboard |
| 7   | Sessions and refresh tokens                   | none (database rows)                                                                                                                                                        | after rows 5 and 6, revoke every session and refresh family (`revoke_user` per account, or delete the rows of `sessions` and `refresh_tokens`)                                                                                                                  | `GET me` with an old cookie or refresh token answers 401                                                                                                                                                                     |
| 8   | SMTP / Resend                                 | `INECEKVAR_SMTP_USERNAME`, `INECEKVAR_SMTP_PASSWORD`; `INECEKVAR_RESEND_WEBHOOK_SECRET`                                                                                     | create a new SMTP credential in Resend and revoke the old one; rotate the webhook signing secret in the Resend dashboard and deploy the new `whsec_` value                                                                                                      | a magic link arrives; a signed test event from the dashboard answers 200, one signed with the old secret 401                                                                                                                 |
| 9   | RevenueCat                                    | `INECEKVAR_REVENUECAT_WEBHOOK_SECRET`, `INECEKVAR_REVENUECAT_API_KEY`                                                                                                       | set a new authorization value in the dashboard and in the API at the same deploy; create a new secret REST key and revoke the old                                                                                                                               | dashboard test event 200; old value 401; nightly reconciliation logs no `aborted`                                                                                                                                            |
| 10  | TOTP encryption key                           | `INECEKVAR_TOTP_ENCRYPTION_KEY`, `INECEKVAR_TOTP_PREVIOUS_ENCRYPTION_KEY`                                                                                                   | key-id rotation of ADR-0037 item 2, below                                                                                                                                                                                                                       | an enrolled admin can still step up                                                                                                                                                                                          |
| 11  | Error reports (only if configured)            | `INECEKVAR_SENTRY_DSN`                                                                                                                                                      | rotate the client key of the project                                                                                                                                                                                                                            | old DSN rejected by the provider                                                                                                                                                                                             |
| 12  | Store and signing credentials                 | upload keystore, Apple `.p8` / `.p12`, CI secrets of `docs/release/signing.md`                                                                                              | Play: request an upload key reset through Play Console support (Play App Signing keeps the app signing key); Apple: revoke the key or certificate in the developer account and create a new one; replace the CI secrets                                         | a build signed with the old upload key is refused by Play                                                                                                                                                                    |

TOTP key-id rotation (ADR-0037 item 2; `docs/ops/env.md`): stored secrets carry an 8-byte key id
(SHA-256 prefix of the key), so two keys can be live at once.

1. Create a new key: `python -c "import secrets,base64;print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())"`.
2. Deploy with `INECEKVAR_TOTP_ENCRYPTION_KEY` = new key and `INECEKVAR_TOTP_PREVIOUS_ENCRYPTION_KEY`
   = old key. Decryption picks the key by id; enrolled users keep working.
3. Run `uv run python -m app.auth.totp_rotation` (from `api/`, same environment): every stored
   secret is re-encrypted under the current key; `totp_enabled_at` and `totp_last_counter` stay.
4. Remove `INECEKVAR_TOTP_PREVIOUS_ENCRYPTION_KEY` and deploy again.
5. If the **old key itself** leaked, the stored TOTP secrets must be treated as known: after step 4,
   ask every admin and moderator to disable and re-enrol TOTP (`DELETE me/totp`, `POST me/totp/enrol`).

A rotation that started without the previous key set fails closed (ADR-0037 review finding 5);
that is the expected signal to go back to step 2.

## 7. Push the rewrite (after approval only)

```sh
cd purge.git
git push --force --mirror origin
```

Then, the same day:

1. Ask GitHub support to remove cached views of the purged commits and pull-request refs (forks
   and `refs/pull/*` are not rewritten by a mirror push).
2. Every collaborator deletes every clone and worktree and clones again.
3. Recreate the pull requests that were open (section 2).
4. Re-run CI on `main` so the history scan runs on the new history.

## 8. Verification

```sh
# In a new clone of the rewritten repository
gitleaks git --no-banner --redact --config .gitleaks.toml --log-opts="--all" .
git log --all --diff-filter=A --name-only --format= -- inecekvar | sort -u | grep -E -i "(^|/)\.env($|\.)|\.keystore$|\.jks$|\.p8$|\.p12$|google-services\.json$|GoogleService-Info\.plist$|key\.properties$"
```

Expected: `no leaks found`; the second command prints only `inecekvar/.env.example`. CI: the
`Scan history` step of "Inecek Var CI" and the `Gitleaks (full history)` job of "Inecek Var
Security" are green on the rewritten `main`. Record both outputs, the old and new object counts
and the list of rotated credentials (names, never values) in an incident note under
`docs/security/`.
