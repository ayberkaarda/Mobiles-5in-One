#!/usr/bin/env bash
# Checks of scripts/ops/backup.sh that need no database, no age binary and no bucket: argument and
# environment validation, secret hygiene of the output, and the upload call, using stub pg_dump,
# age and aws commands on PATH. Run: bash scripts/ops/backup.test.sh
#
# Secret-looking values are assembled at run time so no literal credential exists in the repository.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="${HERE}/backup.sh"
SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/kadro-backup-test.XXXXXX")"
trap 'rm -rf -- "${SANDBOX}"' EXIT
STUBS="${SANDBOX}/bin"
mkdir -p "${STUBS}"

PASSED=0
FAILED=0
ok() {
  PASSED=$((PASSED + 1))
  echo "ok   - $1"
}
not_ok() {
  FAILED=$((FAILED + 1))
  echo "FAIL - $1"
  [ -z "${2:-}" ] || printf '       %s\n' "$2"
}

# Run-time dummy values.
STAMP="$(date +%s)"
DB_PASSWORD="pw${STAMP}x$$"
UPLOAD_SECRET="upload${STAMP}y$$"
UPLOAD_KEY_ID="keyid${STAMP}"
RECIPIENT="age1$(printf 'q%.0s' $(seq 1 58))"
DB_URL="postgres://backup:${DB_PASSWORD}@db.internal:5432/kadro"

# Stub tools. pg_dump honours STUB_PG_DUMP_FAIL; age writes an age header plus stdin; aws records
# its arguments and whether the expected credentials arrived through the environment.
cat >"${STUBS}/pg_dump" <<'STUB'
#!/usr/bin/env bash
[ -z "${STUB_PG_DUMP_FAIL:-}" ] || { echo "pg_dump: connection refused" >&2; exit 1; }
printf 'PGDMP-stub-custom-format-dump'
STUB
cat >"${STUBS}/age" <<'STUB'
#!/usr/bin/env bash
out=""
while [ "$#" -gt 0 ]; do
  [ "$1" != "--output" ] || out="$2"
  shift
done
{ printf 'age-encryption.org/v1\n'; cat; } >"${out}"
STUB
cat >"${STUBS}/aws" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$@" >"${STUB_AWS_LOG}"
printf 'key_id=%s\nsecret_set=%s\nregion=%s\n' "${AWS_ACCESS_KEY_ID:-}" \
  "$([ -n "${AWS_SECRET_ACCESS_KEY:-}" ] && echo yes || echo no)" "${AWS_DEFAULT_REGION:-}" >>"${STUB_AWS_LOG}"
STUB
chmod +x "${STUBS}/pg_dump" "${STUBS}/age" "${STUBS}/aws"
export STUB_AWS_LOG="${SANDBOX}/aws.log"

# run <env assignments...> -- <script args...>; sets CODE and OUT (stdout and stderr).
run() {
  local envs=()
  while [ "$#" -gt 0 ] && [ "$1" != "--" ]; do
    envs+=("$1")
    shift
  done
  [ "$#" -eq 0 ] || shift
  OUT="$(env -i HOME="${SANDBOX}" TMPDIR="${SANDBOX}" PATH="${STUBS}:/usr/bin:/bin" STUB_AWS_LOG="${STUB_AWS_LOG}" "${envs[@]}" \
    bash "${SCRIPT}" "$@" 2>&1)"
  CODE=$?
}

FULL_ENV=(
  "DATABASE_URL=${DB_URL}"
  "BACKUP_AGE_RECIPIENT=${RECIPIENT}"
  "R2_ENDPOINT=https://example-account.r2.cloudflarestorage.com"
  "BACKUP_UPLOAD_ACCESS_KEY_ID=${UPLOAD_KEY_ID}"
  "BACKUP_UPLOAD_SECRET_ACCESS_KEY=${UPLOAD_SECRET}"
  "BACKUP_DATE=20261003"
)
ALL_OUTPUT=""
record() { ALL_OUTPUT="${ALL_OUTPUT}${OUT}"$'\n'; }

expect() { # expect <name> <code> <substring>
  if [ "${CODE}" -eq "$2" ] && [[ "${OUT}" == *"$3"* ]]; then
    ok "$1"
  else
    not_ok "$1" "exit ${CODE}, output: ${OUT}"
  fi
}

run --
record
expect "refuses without environment and names every missing variable" 2 \
  "missing environment: DATABASE_URL BACKUP_AGE_RECIPIENT R2_ENDPOINT BACKUP_UPLOAD_ACCESS_KEY_ID BACKUP_UPLOAD_SECRET_ACCESS_KEY"

run -- --dry-run
record
if [ "${CODE}" -eq 2 ] && [[ "${OUT}" == *"missing environment: DATABASE_URL BACKUP_AGE_RECIPIENT" ]]; then
  ok "dry run does not require upload variables"
else
  not_ok "dry run does not require upload variables" "exit ${CODE}, output: ${OUT}"
fi

run -- --bogus
record
expect "rejects an unknown argument" 2 "unknown argument: --bogus"

run "${FULL_ENV[@]}" "DATABASE_URL=mysql://u:${DB_PASSWORD}@h/db" --
record
expect "rejects a non-postgres DATABASE_URL" 2 "DATABASE_URL must be a postgres://"

run "${FULL_ENV[@]}" "BACKUP_AGE_RECIPIENT=not-a-key" --
record
expect "rejects a malformed age recipient" 2 "BACKUP_AGE_RECIPIENT is not an age public key"

run "${FULL_ENV[@]}" "BACKUP_DATE=2026-10-03" --
record
expect "rejects a malformed BACKUP_DATE" 2 "BACKUP_DATE must be YYYYMMDD"

run "${FULL_ENV[@]}" "BACKUP_PREFIX=kadro dumps" --
record
expect "rejects a BACKUP_PREFIX with spaces" 2 "BACKUP_PREFIX may only contain"

run "${FULL_ENV[@]}" "R2_ENDPOINT=http://bucket.example.com" --
record
expect "rejects a plain-http endpoint that is not localhost" 2 "R2_ENDPOINT must use https"

OUT="$(env -i HOME="${SANDBOX}" PATH="/nonexistent" "${FULL_ENV[@]}" /bin/bash "${SCRIPT}" 2>&1)"
CODE=$?
record
expect "refuses when pg_dump is not installed" 2 "required tool not found on PATH: pg_dump"

run "${FULL_ENV[@]}" -- --help
expect "--help prints the usage" 0 "Usage: scripts/ops/backup.sh"

run "${FULL_ENV[@]}" -- --dry-run --out "${SANDBOX}/kept.dump.age"
record
if [ "${CODE}" -eq 0 ] && [[ "${OUT}" == *"skipped upload to s3://kadro-backups/kadro-20261003.dump.age"* ]] &&
  [ ! -e "${STUB_AWS_LOG}" ] && [ "$(head -c 21 "${SANDBOX}/kept.dump.age")" = "age-encryption.org/v1" ]; then
  ok "dry run dumps and encrypts, keeps --out, never calls aws"
else
  not_ok "dry run dumps and encrypts, keeps --out, never calls aws" "exit ${CODE}, output: ${OUT}"
fi

run "${FULL_ENV[@]}" -- --dry-run --out "${SANDBOX}/kept.dump.age"
record
expect "refuses to overwrite an existing --out file" 2 "--out file already exists"

run "${FULL_ENV[@]}" "STUB_PG_DUMP_FAIL=1" -- --dry-run --out "${SANDBOX}/partial.dump.age"
record
if [ "${CODE}" -ne 0 ] && [ ! -e "${SANDBOX}/partial.dump.age" ] && [[ "${OUT}" != *RESULT* ]]; then
  ok "a pg_dump failure fails the run and removes the partial file"
else
  not_ok "a pg_dump failure fails the run and removes the partial file" "exit ${CODE}, output: ${OUT}"
fi

run "${FULL_ENV[@]}" --
record
AWS_ARGS="$(cat "${STUB_AWS_LOG}" 2>/dev/null || true)"
if [ "${CODE}" -eq 0 ] && [[ "${AWS_ARGS}" == *"s3://kadro-backups/kadro-20261003.dump.age"* ]] &&
  [[ "${AWS_ARGS}" == *"key_id=${UPLOAD_KEY_ID}"* ]] && [[ "${AWS_ARGS}" == *"secret_set=yes"* ]] &&
  [[ "${AWS_ARGS}" == *"region=auto"* ]] && [[ "${AWS_ARGS}" != *"${UPLOAD_SECRET}"* ]]; then
  ok "upload goes to the dated key with credentials only in the environment"
else
  not_ok "upload goes to the dated key with credentials only in the environment" "exit ${CODE}, output: ${OUT}, aws: ${AWS_ARGS}"
fi

if [[ "${ALL_OUTPUT}" != *"${DB_PASSWORD}"* ]] && [[ "${ALL_OUTPUT}" != *"${UPLOAD_SECRET}"* ]] &&
  [[ "${ALL_OUTPUT}" != *"${UPLOAD_KEY_ID}"* ]] && [[ "${ALL_OUTPUT}" != *"db.internal"* ]]; then
  ok "no run printed the database password, host or upload credentials"
else
  not_ok "no run printed the database password, host or upload credentials"
fi

echo "${PASSED} passed, ${FAILED} failed"
[ "${FAILED}" -eq 0 ]
