# Runbook: leaked secret in Git history

|        |                                                                                                                                                                                        |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Item   | Security checklist item 2 (product spec §6)                                                                                                                                            |
| Status | **Document only. Nothing in this file has been run.** Every step that rewrites history or pushes needs the owner's explicit approval.                                                  |
| Owner  | Repository owner. Rotation may start at once; the rewrite waits for approval.                                                                                                          |
| See    | [`docs/security/history-purge-runbook.md`](../security/history-purge-runbook.md) holds the per-secret rotation table; this file is the release-time checklist and verification record. |

## 0. Principle

A secret that reached any remote is compromised, rewritten history or not (forks, clones, CI caches,
provider copies). **Rotate first, rewrite second.** Rewriting only stops further spread.

## 1. Detect and scope (read-only, safe)

```sh
# Full-history scan with the repository configuration
gitleaks git --no-banner --redact --config .gitleaks.toml --log-opts="--all" .

# Commits that ever touched an env file, on all refs
git log --all --oneline -- .env .env.local '**/.env' '**/.env.local'

# Was the commit ever pushed or tagged?
git branch -a --contains <commit>
git tag --contains <commit>
```

Record commit ids, file paths and variable **names** in the incident note. Never copy values.
Decide whether the repository was public or forked while the secret was exposed; that sets how urgent
section 2 is.

## 2. Rotate (before any rewrite)

Follow section 4 of the security runbook linked above. Summary of what to rotate, highest impact
first: database password, JWT signing key pair, CSRF secret, keyed-hash secret, R2 access keys (web
upload and worker), Expo access token, Resend API key, RevenueCat webhook secret.

Per secret: create the new value in the provider console or locally, deploy it from the server's
secret store, **confirm the old value is refused**, then revoke it. All provider-console steps are
**owner tasks**. If the JWT key, CSRF secret or database password leaked, also revoke all refresh
tokens so every session signs in again.

## 3. Rewrite history (after approval)

Prerequisite: `git filter-repo` installed. Work only in a **fresh mirror clone**, never in a
working clone.

```sh
git clone --mirror <remote-url> repo-purge.git
cd repo-purge.git

# Remove the leaked files from every commit (one --path per file; exact paths)
git filter-repo --invert-paths --path .env --path .env.local
# While Kadro lives under kadro/ in the monorepo:
#   git filter-repo --invert-paths --path kadro/.env --path kadro/.env.local

# If the secret was a string inside a file that must stay, use a replacement file instead:
#   git filter-repo --replace-text replacements.txt     # lines: literal==>REMOVED
# Keep replacements.txt outside the repository and delete it afterwards.
```

Verify before pushing, inside the mirror:

```sh
git log --all --oneline -- .env .env.local               # must print nothing
gitleaks git --no-banner --redact --log-opts="--all" .   # must report no leaks
```

## 4. Force-push coordination (owner only)

1. Announce a freeze: no pushes, no merges, no open-PR updates until the all-clear.
2. List open PRs and local branches that must be rebuilt on the new history. They will not apply
   cleanly; plan to recreate them from patches (`git format-patch` taken beforehand).
3. Lift branch protection on the affected branches, push, restore protection immediately:
   `git push --force --mirror origin` (the owner runs this; it is destructive and cannot be undone
   on the remote).
4. Every collaborator and CI runner discards its clone and clones again. Pulling into an old clone
   re-introduces the secret.
5. Ask the hosting provider's support to garbage-collect unreachable objects and clear cached views
   and pull-request refs if the secret was ever visible on the web. Forks keep their own copy; ask
   fork owners to delete them. **Owner task.**

## 5. Verify and close

| Check                                                                 | Command or evidence                                                |
| --------------------------------------------------------------------- | ------------------------------------------------------------------ |
| No env file in any commit                                             | `git log --all --oneline -- .env .env.local` prints nothing        |
| Scanner clean on rewritten history                                    | `gitleaks git --no-banner --redact --log-opts="--all" .`: no leaks |
| CI job `Gitleaks (full history)` green on the new `main`              | CI run link in the incident note                                   |
| Old credentials refused                                               | one refusal per rotated secret, noted by name                      |
| `.gitignore` still covers `.env` and `.env.*` (except `.env.example`) | `git check-ignore -v .env`                                         |
| Pre-commit scan installed on every developer machine                  | `gitleaks git --pre-commit --staged` hook via `lefthook.yml`       |

The incident note contains: removed commit ids, rotated variable names, force-push time, scanner
output after the rewrite, who re-cloned. Add a preventive action if the cause was a process gap.
