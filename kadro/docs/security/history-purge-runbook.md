# Runbook: purge a committed `.env` from Git history and rotate secrets

|         |                                                                                                                                                             |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Item    | Security checklist item 2 (product spec §6)                                                                                                                 |
| Status  | Procedure only. **Not executed.** Every step that rewrites history or pushes needs the repository owner's approval.                                         |
| Trigger | gitleaks reports a finding in history (CI job `Gitleaks (full history)` in `.github/workflows/kadro-security.yml`), or a `.env` file is found in any commit |
| Owner   | Repository owner (Ayberk). Secret rotation can start immediately; the history rewrite waits for approval.                                                   |

## 1. Order of work

Rotation comes first. A secret that reached a remote is compromised whether or not the history is
rewritten later: forks, clones, CI caches and the hosting provider's own copies keep it. Rewriting
history only stops further spread.

1. Rotate every secret in section 4 that the leaked file contained (section 4 lists all of them;
   rotate all when in doubt).
2. Confirm the old values no longer work (section 4, "Check").
3. Rewrite history (section 3) after approval.
4. Force-push and have every collaborator re-clone (section 3.4).
5. Re-run gitleaks over the full history (section 5) and record the result.

## 2. Find what leaked

Read-only commands, safe to run at any time:

```sh
# Every commit that touched an env file, on every ref
git log --all --oneline -- .env .env.local '**/.env' '**/.env.local'

# Secret scan of the full history with the repository configuration
gitleaks git --no-banner --redact --log-opts="--all" .
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

### 3.2 Remove the files from every commit

When Kadro is the repository root (as in the product spec):

```sh
git filter-repo --invert-paths --path .env --path .env.local
```

While Kadro lives in the `kadro/` subdirectory of the `Mobil-Package` repository, the paths carry
that prefix:

```sh
git filter-repo --invert-paths --path kadro/.env --path kadro/.env.local
```

Add one `--path` per additional leaked file (for example `--path apps/web/.env.local`). `--path`
matches exact paths; use `--path-glob '*.env.local'` only after checking with `git log --all`
which files it would remove.

### 3.3 Verify before pushing

```sh
git log --all --oneline -- .env .env.local          # must print nothing
gitleaks git --no-banner --redact --log-opts="--all" .   # must report "no leaks found"
```

### 3.4 Force-push

> **Warning: force-pushing rewritten history is destructive and cannot be undone from the remote.**
>
> - Every commit id after the first removed file changes. Open pull requests, review comments
>   anchored to commits, tags and release links that point to old ids break.
> - Branch protection on `main` must be lifted for the push and restored right after it.
> - Every collaborator and every CI runner must delete its clone and clone again. Pulling into an
>   old clone merges the old history back and re-introduces the secret.
> - GitHub keeps unreferenced commits reachable by id for some time and in forks. Ask GitHub
>   Support to run garbage collection on the repository and to purge cached views if the secret
>   was visible on the web interface.

```sh
git push --force --mirror origin
```

Then restore branch protection and tell all collaborators to re-clone.

## 4. Rotation list

Rotate in this order (highest impact first). New values come from `pnpm --filter @kadro/config
secrets:generate` where the value is generated locally, or from the provider console. Store new
values only in the deployment's secret store (server environment, EAS Secrets for build-time
values); never in a file inside the repository.

| Secret                               | Variable(s)                                                                                                                                    | Where to rotate                                                                                                         | Effect of rotation                                                                                                                      | Check that the old value is dead                                                    |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Database password                    | `DATABASE_URL`, `POSTGRES_PASSWORD`                                                                                                            | `ALTER ROLE … PASSWORD …` on the server (managed provider console if used), then update web and worker environment      | Brief reconnect of web and worker pools                                                                                                 | `psql` with the old URL fails authentication                                        |
| JWT signing key pair (ES256)         | `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`                                                                                                            | Generate a new P-256 pair, deploy both values together                                                                  | Every issued access token becomes invalid; mobile clients refresh once                                                                  | An access token signed before the deploy gets 401 on `GET /api/v1/me`               |
| CSRF secret                          | `CSRF_SECRET`                                                                                                                                  | Generate, deploy                                                                                                        | Web CSRF tokens become invalid; browsers get a new token at next sign-in or refresh                                                     | A web mutation with an old CSRF token gets 403 `csrf_failed`                        |
| Keyed-hash secret                    | `HASH_SECRET`                                                                                                                                  | Generate, deploy                                                                                                        | Existing rate-limit buckets stop matching (limits restart); `audit_logs.ip_hash` values before and after no longer correlate (ADR-0023) | Not observable from outside; confirm the deployed value differs from the leaked one |
| Cloudflare R2 access keys            | Web upload key `R2_UPLOAD_ACCESS_KEY_ID` / `R2_UPLOAD_SECRET_ACCESS_KEY` and worker key `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` (ADR-0030) | Cloudflare dashboard → R2 → API tokens: create new tokens with the same bucket scopes, deploy, then revoke the old ones | Presigned URLs issued with the old web key stop working; uploads in flight are retried by the client                                    | An S3 `ListObjects` call with the old key is refused                                |
| Expo access token                    | `EXPO_ACCESS_TOKEN` (ADR-0031)                                                                                                                 | Expo dashboard → Access tokens: create a robot token, deploy to the worker, revoke the old one                          | Pushes fail until the worker has the new token; queued `push.send` jobs retry                                                           | A push request with the old token is refused                                        |
| Resend API key                       | `RESEND_API_KEY`                                                                                                                               | Resend dashboard → API Keys: create, deploy, delete the old key                                                         | None for users                                                                                                                          | A request to the Resend API with the old key returns 401                            |
| RevenueCat webhook secret            | `REVENUECAT_WEBHOOK_SECRET` (Phase 5)                                                                                                          | RevenueCat dashboard → Integrations → Webhooks: set the new authorization value, deploy                                 | Webhooks in flight during the switch are retried by RevenueCat                                                                          | A webhook call with the old value gets 401                                          |
| Apple / Google sign-in configuration | `APPLE_AUDIENCES`, `GOOGLE_CLIENT_IDS`                                                                                                         | Not secrets (public identifiers); no rotation needed                                                                    | —                                                                                                                                       | —                                                                                   |

After rotation, revoke all sessions if the JWT key, the CSRF secret or the database password
leaked together with a database dump: `UPDATE refresh_tokens SET revoked_at = now() WHERE
revoked_at IS NULL;` (forces every user to sign in again).

## 5. Close the incident

- Record in the incident note: commit ids removed, variables rotated (names only), time of the
  force-push, gitleaks result after the rewrite.
- Confirm the CI job `Gitleaks (full history)` is green on the rewritten `main`.
- Check that `.gitignore` still covers `.env` and `.env.*` (with `!.env.example`) and that the
  local pre-commit hook (`gitleaks git --pre-commit --staged`, `lefthook.yml`) is installed on
  every developer machine.
