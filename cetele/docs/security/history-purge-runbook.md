# History purge and secret rotation runbook

|                |                                                                                                                                                                                                                                    |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status         | **Not executed. Owner action.** Spec section 6 item 2. A history rewrite and a force push change every clone and fork of the repository, so only the repository owner (Ayberk) runs it. No worker runs any command of this file. |
| Scope          | The whole repository `Mobiles-5in-One` (Çetele lives under `cetele/`, next to other projects). The purge removes secret-bearing file types from every commit of every ref; the rotation list covers Çetele's server secrets.       |
| Trigger        | A secret file was committed, a secret value was pasted into a tracked file, or the CI history scan (below) reports a finding.                                                                                                      |
| Rule one       | **Rotate first, purge second.** A purged secret is still a leaked secret: clones, forks, CI caches and GitHub's own pull-request refs keep the old commits. Rotation is the fix; the purge is hygiene.                             |
| Companion docs | [verification-matrix.md](verification-matrix.md) (item 2), [../ops/env.md](../ops/env.md) (every key named below), [ADR-0004](../adr/0004-portfolio-delivery-scope.md) (no real provider accounts exist).                        |

## 1. What is guarded today

- `.gitignore` at the repository root ignores `.env`, `.env.*` (except `.env.example`),
  `local.properties`, `keystore.properties`, `*.jks`, `*.keystore` and `service-account*.json`.
- CI job `Cetele placeholder grep` in `.github/workflows/cetele-ci.yml` installs gitleaks and scans
  every commit of every ref: `gitleaks git --no-banner --redact --config .gitleaks.toml
  --log-opts="--all" .`, with a full clone (`fetch-depth: 0`). This is the history scan item 2 asks
  for.
- A look at this clone on 2026-10-11 (`git log --all --diff-filter=A --name-only` over the patterns of
  section 3, 1 192 commits) found only `askida/server/.env.example`, `cetele/.env.example` and
  `kadro/.env.example`, which are templates without values and must survive the purge. This is a
  file-name check of one clone, not a statement that no secret value was ever committed; the
  gitleaks job is the value check.

## 2. Before the rewrite

1. Rotate every secret that may have leaked (section 5). Revoke the old values at the provider.
2. Announce a freeze: no pushes, no merges, until step 6 of section 3 is done. Close or merge open
   pull requests first; a rewrite orphans their branches.
3. Install `git-filter-repo` (Python 3; `pip install git-filter-repo`) on the machine that runs the
   purge. It refuses to run on a clone that is not fresh, which is intended.
4. Make an offline backup that is kept until the checks of section 3 pass, then destroyed:

   ```sh
   git clone --mirror https://github.com/ayberkaarda/Mobiles-5in-One.git mobiles-backup.git
   ```

## 3. The purge

Run in a fresh mirror clone, never in a working checkout:

```sh
git clone --mirror https://github.com/ayberkaarda/Mobiles-5in-One.git mobiles-purge.git
cd mobiles-purge.git

# 1. Remove the secret-bearing file types from every commit of every ref.
#    `.env.example` templates are kept on purpose (negative lookahead).
git filter-repo --invert-paths \
  --path-regex '(^|/)\.env$' \
  --path-regex '(^|/)\.env\.(?!example$)[^/]+$' \
  --path-regex '(^|/)local\.properties$' \
  --path-regex '(^|/)keystore\.properties$' \
  --path-regex '\.jks$' \
  --path-regex '\.keystore$' \
  --path-regex '(^|/)service-account[^/]*\.json$'

# 2. Only when a secret value was pasted into a file that must stay (a doc, a test, a config):
#    list each literal once per line in a file OUTSIDE the repository, then replace it everywhere.
#    Format of each line: the literal value, or `literal:<value>==>***REMOVED***`.
git filter-repo --replace-text ../secrets-to-remove.txt
```

Check before pushing anything:

```sh
# 3. No secret file names remain in any commit.
git log --all --name-only --format='' | grep -E '(^|/)(\.env(\.[^/]+)?|local\.properties|keystore\.properties|service-account[^/]*\.json)$|\.(jks|keystore)$' | grep -v '\.env\.example$'
# expected: no output

# 4. The value scan is clean on the rewritten history.
gitleaks git --no-banner --redact --config .gitleaks.toml --log-opts="--all" .
# expected: "no leaks found"

# 5. The templates and the current tree are intact.
git show HEAD:cetele/.env.example | head -5
```

Publish (owner only, after the checks above):

```sh
# 6. filter-repo removes the origin remote; add it back and overwrite every branch and tag.
git remote add origin https://github.com/ayberkaarda/Mobiles-5in-One.git
git push --force --mirror origin
```

Branch protection on `main` must be lifted for the push and restored right after it.

## 4. After the push

1. Every collaborator deletes their clone and worktrees and clones again. An old clone pushed back
   would reintroduce the purged commits; do not `pull` into it.
2. GitHub keeps the old commits reachable through `refs/pull/*` of closed pull requests and in its
   caches. Ask GitHub Support to run a garbage collection and drop cached views of the affected
   commits (their sensitive-data removal process). Forks keep their own copies and are out of reach.
3. Invalidate CI caches that may hold a checked-out tree (GitHub Actions caches of the repository).
4. Re-run the `Cetele placeholder grep` job on `main` and keep its log as the retest evidence.
5. Record the date, the commit range and the rotated secrets in the security verification matrix
   (item 2) with the command output, per ADR-0004.

## 5. Rotation list

Rotate in this order, and before the purge. Every key is described in [../ops/env.md](../ops/env.md).
"Effect" is what users or operators notice. Nothing in this table has been exercised against a real
provider (ADR-0004: no hosting, SMS, Play or Google Cloud account exists).

| #   | Secret                                   | Environment key(s)                                                     | How to rotate                                                                                                                                                                                                                     | Effect of rotation                                                                                                                                                                                                         |
| --- | ---------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Database password                        | `CETELE_DB_PASSWORD`                                                   | `ALTER ROLE <app role> WITH PASSWORD '<new>';` as the database owner, update the environment, restart the server. Rotate the backup job's credentials as well.                                                                     | Connections drop at restart. No data change.                                                                                                                                                                               |
| 2   | JWT signing key pair (ES256, P-256)      | `CETELE_JWT_ES256_PRIVATE_KEY_PEM`, `CETELE_JWT_ES256_PUBLIC_KEY_PEM`  | `openssl ecparam -name prime256v1 -genkey -noout \| openssl pkcs8 -topk8 -nocrypt` for the private key, `openssl ec -pubout` for the public key; deploy both together.                                                              | Every access token becomes invalid (at most 15 minutes of life anyway); apps refresh. Refresh tokens are stored as SHA-256 and are unaffected. The code knows one fixed `kid` (`es256-1`), so there is no overlap window.   |
| 3   | Object storage keys (S3-compatible / R2) | `CETELE_S3_ACCESS_KEY`, `CETELE_S3_SECRET_KEY`                         | Create a new token at the provider with the same bucket scope, deploy it, then delete the old token.                                                                                                                              | Presigned upload and download URLs signed with the old key stop working (10-minute lifetime); the app retries.                                                                                                             |
| 4   | SMS provider API credentials             | `CETELE_NETGSM_USERNAME`, `CETELE_NETGSM_PASSWORD`                     | Change the API user's password (or create a new API user) in the provider panel, deploy, disable the old one.                                                                                                                     | SMS sending fails between the provider change and the deploy; keep that window short.                                                                                                                                      |
| 5   | SMS delivery-report secret               | `CETELE_SMS_DLR_SECRET`, `CETELE_SMS_DLR_PREVIOUS_SECRET`              | Move the current value to `CETELE_SMS_DLR_PREVIOUS_SECRET`, set a new `CETELE_SMS_DLR_SECRET` (at least 32 bytes), update the relay, then clear the previous value.                                                                 | None while both are set (the verifier accepts either, ADR-0032).                                                                                                                                                           |
| 6   | Play service account key                 | `CETELE_PLAY_SERVICE_ACCOUNT_JSON`                                     | Google Cloud console: create a new JSON key for the same service account, deploy it, delete the old key ID.                                                                                                                       | Purchase verification and integrity decoding pause only if the old key is deleted before the deploy.                                                                                                                       |
| 7   | Admin TOTP encryption key                | `CETELE_ADMIN_TOTP_KEY`                                                | New Base64 32-byte value (`openssl rand -base64 32`). `TotpCipher` holds one key and no key id, so stored secrets cannot be re-encrypted in place: plan a re-enrolment of every console account (`/admin/admins/{id}/totp-reset`). | Stored TOTP secrets no longer decrypt. How sign-in behaves for an account whose secret no longer decrypts was not exercised; do the re-enrolment in a maintenance window with a second ADMIN ready.                         |
| 8   | Audit IP key                             | `CETELE_AUDIT_IP_KEY`                                                  | New Base64 32-byte value, deploy.                                                                                                                                                                                                 | New `audit_logs.ip_hash` values are no longer comparable with older ones. No data loss.                                                                                                                                    |
| 9   | Billing purchase-token key               | `CETELE_BILLING_TOKEN_KEY`                                             | New Base64 32-byte value. `PurchaseTokenCipher` holds one key and no key id: before rotating, a migration that re-encrypts `subscriptions` tokens (or key versioning) is needed; this is a code change, not an operation.          | Without the migration, stored purchase tokens read as unavailable after the deploy (the token hash used for lookups stays valid). Do not rotate without the migration unless the key is known to be leaked.               |
| 10  | OTP pepper                               | `CETELE_OTP_PEPPER`                                                    | New value of at least 32 bytes, deploy.                                                                                                                                                                                           | Open sign-in and re-authentication codes (5-minute life) and open staff invitations stop matching (the invitation hash is keyed with the pepper); owners re-send invitations.                                              |
| 11  | Console bootstrap credentials            | `CETELE_ADMIN_BOOTSTRAP_EMAIL`, `CETELE_ADMIN_BOOTSTRAP_PASSWORD`      | Change the bootstrap account's password in the console, then remove both keys from the environment.                                                                                                                               | None.                                                                                                                                                                                                                      |
| 12  | Android signing material                 | `keystore.properties`, `*.jks` (local files, never in the environment) | None exists yet (ADR-0004 G6). If an upload key ever leaks: request an upload-key reset in the Play Console.                                                                                                                      | Not applicable today.                                                                                                                                                                                                      |

Items 1 to 6 are the rotation list of spec section 6 item 2; items 7 to 12 cover the other secrets
the server reads today.

## 6. Evidence

- Executed: none of the commands of sections 2 to 4. `not exercised: a history rewrite and force
  push are an owner action`.
- Executed while writing this runbook: the file-name look at the history in section 1 (one clone,
  2026-10-11). The full-history gitleaks scan runs in CI on every change to `cetele/`.
