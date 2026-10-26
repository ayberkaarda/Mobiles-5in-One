# History purge runbook

Security checklist item 2 (`.env`'i geçmişten sil), adapted from the iOS spec to the Android and Google Play stack.

**Status: not executed. No leak found; CI gitleaks scans all refs.** `patika-ci.yml` job "Patika secret scan" runs `gitleaks git --log-opts="--all"` with the repository `.gitleaks.toml` on every Patika change. A local run on 2026-10-26 (gitleaks 8.30.1, `--log-opts="--all -- patika"`) reported `88 commits scanned ... no leaks found`, and `git log --all --name-only -- 'patika/*'` lists no `.env`, keystore, `google-services.json`, `appsettings.Production.json`, service-account or key-ring file (only `patika/.env.example`, which holds empty keys).

This runbook is for the day a secret does reach git. Rewriting history is the last step; **rotation comes first**, because anything pushed to GitHub has to be treated as copied (forks, clones, caches, CI logs).

## 1. Contain (minutes)

1. Identify the secret and every place it is valid (table in section 4). Revoke or rotate it now; do not wait for the purge.
2. If the commit is only local, `git reset` it and stop here after rotation if it was never pushed.
3. Freeze merges to `main` while the rewrite is prepared (branch protection, or tell collaborators).
4. Note the commit range: `git log --all --oneline -- <path>` and `gitleaks git --log-opts="--all" --report-path leak.json`.

## 2. Rewrite history with git filter-repo

Run on a fresh mirror clone, never on a working copy:

```bash
git clone --mirror git@github.com:ayberkaarda/mobiles.git mobiles-purge.git
cd mobiles-purge.git
```

Remove files by path or glob (each `--path-glob` matches anywhere in the tree, `--invert-paths` deletes the matches):

```bash
git filter-repo --invert-paths \
  --path-glob 'patika/.env' \
  --path-glob 'patika/**/.env' \
  --path-glob 'patika/**/.env.*' \
  --path-glob 'patika/**/*.keystore' \
  --path-glob 'patika/**/*.jks' \
  --path-glob 'patika/**/google-services.json' \
  --path-glob 'patika/**/appsettings.Production.json' \
  --path-glob 'patika/**/*service-account*.json' \
  --path-glob 'patika/**/*-sa.json' \
  --path-glob 'patika/**/keys/key-*.xml'
```

`.env.example` is matched by `patika/**/.env.*`; if it has to stay, put it back afterwards from a clean copy or add `--path patika/.env.example` to a second, non-inverted pass that keeps it. The Data Protection key ring is the `key-<guid>.xml` files under `DataProtection:KeysPath` (`/keys` in compose); adjust the glob to wherever a leaked ring was committed.

If a secret value was pasted into a tracked file (for example a JSON service-account key inside a test fixture), replace the value instead of deleting the file:

```bash
cat > ../replacements.txt <<'EOF'
literal-secret-value==>REDACTED
regex:-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----==>REDACTED_PRIVATE_KEY
EOF
git filter-repo --replace-text ../replacements.txt
```

Verify before pushing:

```bash
git log --all --oneline -- 'patika/**/.env' 'patika/**/*.keystore' 'patika/**/*.jks'   # expect nothing
gitleaks git --no-banner --redact --log-opts="--all" .                                   # expect "no leaks found"
```

## 3. Force-push and re-clone

1. `git push --force --mirror origin` from the mirror (filter-repo removes the `origin` remote; add it back first). Branch protection on `main` must allow the force push for the duration; turn it back on immediately afterwards.
2. Open pull requests keep the old commits: close them and reopen from rewritten branches.
3. Ask GitHub Support to purge cached views of the removed commits and to run garbage collection (the "removing sensitive data" flow); forks are not rewritten and must be handled with their owners.
4. Every collaborator deletes their clone and clones again. Pulling into an old clone re-introduces the commits. Old worktrees (`.worktrees/*`) count as clones.
5. Re-run the Patika CI secret scan on the rewritten `main`, and delete CI artifacts or caches that may contain the secret (workflow logs, uploaded artifacts).

## 4. Rotation list

Rotate everything that was in the leaked file, even if it looks unused. Where a value is derived from another (noted below), rotating the parent rotates the child.

| Secret | Where it lives (config key) | Rotation | Impact of rotating |
| --- | --- | --- | --- |
| PostgreSQL password | `ConnectionStrings__Patika`, `ConnectionStrings__PatikaRead`, `POSTGRES_PASSWORD` | `ALTER ROLE ... PASSWORD`, then update API, Worker, Web and the backup job | Short reconnect; no data impact |
| JWT signing key (P-256) | `Jwt__SigningKey` | Generate a new key, deploy to every API instance | All access tokens (15 min) become invalid; refresh tokens keep working. The email-code key and the billing account key are derived from it by HKDF unless `Auth__EmailCodes__Key` / `Billing__AccountKey` are set: open email codes stop verifying and purchases bound to the old account id must be re-bound (ADR-0010) |
| Email code key | `Auth__EmailCodes__Key` (when set) | New 32-byte base64 value | Codes issued in the last 15 minutes stop verifying |
| Billing account key | `Billing__AccountKey` (when set) | New 32-byte base64 value | Earlier purchases no longer match the obfuscated account id; restore re-binds them |
| Data Protection key ring | Files under `DataProtection__KeysPath` (shared by API and Worker) | Add a new key and revoke the leaked one (`IKeyManager.RevokeKey` or set its `revocationDate`); never just delete the ring | TOTP secrets (`users.totp_secret_enc`) and purchase tokens (`subscriptions.protected_purchase_token`) are encrypted with this ring. A revoked key no longer unprotects (short of `IPersistedDataProtector.DangerousUnprotect`), so before revoking, run a one-off job that unprotects every TOTP secret and purchase token and protects it again under the new default key. Without that job every admin must re-enrol TOTP and each subscription's purchase token must come back from the next purchase or restore |
| Object storage keys (R2 / MinIO) | `Storage__AccessKey`, `Storage__SecretKey` | Create a new token in R2, deploy, delete the old token | Presigned URLs already issued stay valid until they expire (5 min PUT, 15 min GET) |
| Backup bucket token | backup job environment (write-only token), restore read-only token | Replace both tokens | None if replaced before the next daily run |
| Backup age identity | offline `age` identity file | New key pair; set `PATIKA_BACKUP_AGE_RECIPIENT` to the new public key | Old backups stay encrypted to the old identity: keep it offline until those backups age out (30 days), or re-encrypt them |
| FCM service account | `Push__Fcm__ServiceAccountJson` | Disable and delete the key in Google Cloud IAM, create a new key | None after deploy |
| Play Developer API service account | Source of `Billing__Google__AccessToken` | Delete the key in Google Cloud IAM, create a new key | Verification and reconcile fail until the new token source is deployed |
| Pub/Sub push service account (RTDN) | `Billing__Rtdn__Email`, `Billing__Rtdn__Audience` | New service account or audience on the push subscription, update both keys | RTDN pushes are rejected until both sides match; reconcile catches up daily |
| Resend API key | `Resend__ApiKey` | Revoke in Resend, create a new key | Emails fail until deploy (registration codes, deletion confirmations) |
| Google Maps API key | Android manifest, build machine only (ADR-0007, not wired yet) | Restrict and regenerate in Google Cloud | Map street layer off until a rebuild |
| Firebase `google-services.json` | build machine, `app/Patika.App/` | Not a secret on its own (it ships in the APK), but restrict the API key it carries to the package and signing certificate | None |
| Upload keystore | build machine only (see [signing](../release/signing.md)) | Request an upload key reset in Play Console (Play App Signing keeps the app signing key) | New uploads need the new key after Google confirms; installed apps are unaffected |
| Admin passwords and TOTP | users table (hashes only) | Force a password reset and TOTP re-enrolment for admins if the database or ring leaked | Admins sign in again |

## 5. Close out

- Record the incident (what leaked, exposure window, rotations done, purge commit range) in `docs/security/threat-model.md` or a dated incident note.
- If the leak was a file type not yet ignored, add the pattern to `patika/.gitignore` and a gitleaks rule. Today `patika/.gitignore` covers `.env`, `.env.*`, `*.p8`, `*.p12`, `*.mobileprovision`, and `patika/app/.gitignore` covers `google-services.json`; `*.keystore`, `*.jks`, `appsettings.Production.json`, service-account JSON and key-ring XML files are **not** ignored yet (verified with `git check-ignore`, see [signing](../release/signing.md)).
