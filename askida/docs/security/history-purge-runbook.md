# Runbook: purge committed secrets from Git history and rotate them

|         |                                                                                                                                                 |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Item    | Security checklist item 2 (product spec section 6)                                                                                              |
| Status  | Procedure only. **Not executed: requires the owner's approval.** Every step that rewrites history or pushes needs the repository owner's approval. |
| Trigger | gitleaks reports a finding in history (job `Gitleaks (full history)` in `.github/workflows/askida-security.yml`), or any file in section 3.2 is found in any commit |
| Owner   | Repository owner. Rotation can start immediately; the history rewrite waits for approval.                                                       |

This is a portfolio project: no production secret exists, no remote has ever held one, and this
runbook has not been run. It is written so that it can be, in the order below.

## 1. Order of work

Rotation comes first. A secret that reached a remote is compromised whether or not the history is
rewritten later: forks, clones, CI caches and the hosting provider's own copies keep it. Rewriting
history only stops further spread.

1. Rotate every secret in section 4 that the leaked file contained (all of them when in doubt),
   in the order of the table.
2. Confirm the old values no longer work (section 4, "Check").
3. Rewrite history (section 3) after approval.
4. Force-push and have every collaborator re-clone (section 3.4).
5. Re-run gitleaks over the full history (section 5) and record the result.

## 2. Find what leaked

Read-only commands, safe at any time:

```sh
# Every commit that touched a file from the target list, on every ref
git log --all --oneline -- askida/server/.env askida/app/env/dev.json \
  '*.jks' '*.p8' '*.p12' '*google-services.json' '*GoogleService-Info.plist' '*service-account*.json'

# Secret scan of the full history with the repository configuration
gitleaks git --config .gitleaks.toml --no-banner --redact --log-opts="--all" .
```

Write down the commit ids and the variable names found (never the values) in the incident note.

## 3. Rewrite history

Prerequisite: `git filter-repo` (<https://github.com/newren/git-filter-repo>) installed. It refuses
to run in a clone that is not fresh; that is intended.

### 3.1 Work in a fresh mirror clone

```sh
git clone --mirror git@github.com:<owner>/<repo>.git repo-purge.git
cd repo-purge.git
```

### 3.2 Targets

Askida lives in the `askida/` subdirectory of the monorepo, so the paths carry that prefix. Files
to remove from every commit:

| Target                                                                | Why it can hold a secret                                  |
| --------------------------------------------------------------------- | --------------------------------------------------------- |
| `askida/server/.env`                                                  | `APP_KEY`, database, Redis, object storage, provider keys |
| `askida/app/env/dev.json`                                             | build-time defines for a developer's own environment      |
| `*.jks` (Android keystores)                                           | upload or release signing key                             |
| `*.p8` (Apple keys)                                                   | DeviceCheck / push signing key                            |
| `*.p12` (certificates)                                                | iOS signing identity                                      |
| `google-services.json`, `GoogleService-Info.plist`                    | Firebase project configuration                            |
| service-account JSON (for example `play-integrity-service-account.json`) | Google API credentials                                 |

`askida/app/env/example.json` and `askida/server/.env.example` are documented dummies and stay.

### 3.3 Dry run

`git filter-repo --dry-run` writes the planned rewrite to `.git/filter-repo/` without changing any
ref. Inspect it before the real run:

```sh
git filter-repo --dry-run --invert-paths \
  --path askida/server/.env \
  --path askida/app/env/dev.json \
  --path-glob '*.jks' --path-glob '*.p8' --path-glob '*.p12' \
  --path-glob '*google-services.json' --path-glob '*GoogleService-Info.plist' \
  --path-glob '*service-account*.json'

# What would be dropped, and nothing else
cat .git/filter-repo/analysis/path-deleted-sizes.txt 2>/dev/null
diff .git/filter-repo/commit-map /dev/null | head
```

`--path-glob` can match more than intended. Before the real run, list what each glob matches:

```sh
git log --all --name-only --format= -- '*.jks' '*.p8' '*.p12' '*google-services.json' \
  '*GoogleService-Info.plist' '*service-account*.json' | sort -u
```

### 3.4 Rewrite and verify

Run the same command without `--dry-run`, then check before anything is pushed:

```sh
git log --all --oneline -- askida/server/.env askida/app/env/dev.json   # must print nothing
gitleaks git --config .gitleaks.toml --no-banner --redact --log-opts="--all" .   # must report "no leaks found"
```

### 3.5 Force-push

> **Warning: force-pushing rewritten history is destructive and cannot be undone from the remote.**
>
> - Every commit id after the first removed file changes. Open pull requests, review comments
>   anchored to commits, tags and release links that point to old ids break.
> - Branch protection on `main` must be lifted for the push and restored right after it.
> - Every collaborator and every CI runner must delete its clone and clone again. Pulling into an
>   old clone merges the old history back and re-introduces the secret.
> - The hosting provider keeps unreferenced commits reachable by id for some time and in forks. Ask
>   its support to run garbage collection on the repository and to purge cached views if the secret
>   was visible on the web interface.

```sh
git push --force --mirror origin
```

Then restore branch protection and tell every collaborator to re-clone.

## 4. Rotation list

Rotate in this order (highest impact first). New values come from the provider console or are
created locally; store them only in the deployment's secret store, never in a file in the
repository.

| #   | Secret                       | Variable(s)                                                                  | How to rotate                                                                                                                                                                                                                                  | Effect of rotation                                                                                                                                     | Check that the old value is dead                                       |
| --- | ---------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| 1   | Application key              | `APP_KEY`                                                                    | Section 4.1: new key, old key into `APP_PREVIOUS_KEYS`, then `php artisan askida:rotate-app-key`                                                                                                                                               | Sessions, signed URLs and queued encrypted payloads made with the old key become invalid; stored ciphertext is re-encrypted by the command             | `rotate-app-key --dry-run` reports every column as already current     |
| 2   | Database password            | `DB_PASSWORD`                                                                | `ALTER ROLE ... PASSWORD ...` on the server, then update server, horizon and scheduler environments                                                                                                                                            | Brief reconnect of the connection pools                                                                                                                | `psql` with the old password fails authentication                      |
| 3   | Redis password               | `REDIS_PASSWORD`                                                             | Set a new password on the Redis server, deploy                                                                                                                                                                                                 | Queue workers reconnect; counters and rate-limit buckets survive                                                                                       | `redis-cli -a <old> ping` is refused                                   |
| 4   | Object storage keys          | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (R2 in production)              | Create a new token with the same bucket scope, deploy, revoke the old one                                                                                                                                                                      | Presigned URLs issued with the old key stop working; the app signs new ones                                                                            | A `ListObjects` call with the old key is refused                       |
| 5   | Backup key and archive password | `BACKUP_AWS_ACCESS_KEY_ID`, `BACKUP_AWS_SECRET_ACCESS_KEY`, `BACKUP_ARCHIVE_PASSWORD` | New backup-disk credentials, then a new archive password. Archives made with the old password stay readable only with the old password: keep it in the ops vault until the last such archive is past retention (see `docs/ops/backup-restore.md`) | Next backup run uses the new values                                                                                                                    | Upload with the old key is refused; a new archive opens only with the new password |
| 6   | Payment provider (iyzico)    | `IYZICO_API_KEY`, `IYZICO_SECRET_KEY`                                        | Provider merchant panel: create new keys, deploy, revoke the old pair                                                                                                                                                                          | Webhook signatures are computed with the new secret; webhooks in flight during the switch are retried by the provider                                  | A provider API call with the old pair returns an authentication error   |
| 7   | Mail provider                | `MAIL_PASSWORD` (or the provider API key)                                    | Provider console: create, deploy, delete the old credential                                                                                                                                                                                    | None for users                                                                                                                                         | An SMTP login with the old credential is refused                       |
| 8   | Apple DeviceCheck key        | `APPLE_DEVICECHECK_P8`, `APPLE_DEVICECHECK_KEY_ID`                           | Apple developer account: create a new key, revoke the old one, deploy both variables together                                                                                                                                                  | Attestation of iOS devices fails until the deploy has the new key                                                                                      | A token signed with the old key is refused by Apple                    |
| 9   | Google service account       | `PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON`                                        | Google Cloud console: create a new key for the service account, deploy, delete the old key                                                                                                                                                     | Android attestation fails until the deploy has the new key                                                                                             | An API call with the old key returns 401                               |
| 10  | Redemption code pepper       | `HOOK_CODE_PEPPER`                                                           | Generate a new random value of at least 32 characters, deploy                                                                                                                                                                                  | **Every live reservation is invalidated**: codes are stored as keyed hashes, so a code issued under the old pepper no longer matches. Reserved units return to the pool at their expiry and donors or recipients must reserve again. Do it at a quiet hour and expect support questions. | A code reserved before the deploy gets the "code not found" answer     |

Not secrets, no rotation: `APPLE_TEAM_ID`, `PLAY_INTEGRITY_PROJECT`, `PLAY_INTEGRITY_PACKAGE_NAME`
(public identifiers). `SENTRY_LARAVEL_DSN` is write-only ingest; replace it only if the project
owner wants to stop a flood of foreign events.

After rotation, revoke every personal access token if the application key or the database password
leaked together with a database dump (forces every user to sign in again):

```sql
DELETE FROM personal_access_tokens WHERE tokenable_type IS NOT NULL;
```

Run it only with explicit approval; it logs everybody out.

### 4.1 Application key and the encrypted columns

`APP_KEY` encrypts three columns: `shops.tax_number_enc`, `shops.iban_enc` and
`users.two_factor_secret` (the TOTP secrets of panel users). Replacing the key without
re-encrypting them makes them unreadable. The command `php artisan askida:rotate-app-key` moves
them to the new key in one transaction.

**The old key is never a command argument.** Process lists and shell history leak arguments, so the
command has no option for it and a test (`tests/Feature/Ops/RotateAppKeyTest.php`) asserts that its
signature has none. The old key comes from the first entry of `APP_PREVIOUS_KEYS` (the variable
Laravel itself reads to keep decrypting with an old key) or, when that is empty, from standard
input with `--stdin`. `--stdin` refuses an interactive terminal, so a key is never typed or echoed.

Steps, on the host that runs the application, outside the repository:

```sh
# 1. Generate the new key and keep it in the secret store (do not echo it into the shell history)
php artisan key:generate --show

# 2. Put the NEW key in APP_KEY and the OLD key as the only entry of APP_PREVIOUS_KEYS in the
#    deployment environment. Laravel now reads old ciphertext with the old key and writes with the new.

# 3. Dry run: counts only, writes nothing
php artisan askida:rotate-app-key --dry-run

# 4. Re-encrypt (transaction, idempotent: safe to run again)
php artisan askida:rotate-app-key

# 5. Dry run again: every column must report 0 rotated
php artisan askida:rotate-app-key --dry-run

# 6. Remove APP_PREVIOUS_KEYS and deploy
```

When the old key must not live in the environment at all, leave `APP_PREVIOUS_KEYS` empty and feed
it from a file that only the operator can read (mode 600, deleted afterwards):
`php artisan askida:rotate-app-key --stdin < /secure/old-app-key`. The command refuses to run when the old key equals
`APP_KEY`, aborts and writes nothing when a value decrypts under neither key, and never prints a key
or a decrypted value.

## 5. Close the incident

- Record in the incident note: commit ids removed, variables rotated (names only), time of the
  force-push, gitleaks result after the rewrite.
- The full-history scan runs in CI as the `Gitleaks (full history)` job of `askida-security.yml`;
  it must be green on the rewritten history.
- Make sure no removed file is tracked again: `git ls-files | grep -E '\.(jks|p8|p12)$|google-services|GoogleService-Info|service-account'` must print nothing.
