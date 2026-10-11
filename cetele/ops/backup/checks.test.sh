#!/bin/sh
# Configuration checks of backup.sh, restore.sh and restore-drill.sh. Needs no Docker, no bucket
# and no age binary: every case stops at a configuration error (exit 2) before any tool runs.
#
# Usage: ops/backup/checks.test.sh
# Exit codes: 0 all cases hold, 1 a case failed.
set -eu
set +x

script_dir="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
out_file="$(mktemp)"
trap 'rm -f "${out_file}"' EXIT

passed=0
failed=0

# A recipient-shaped and a secret-shaped value, built at run time so no key-like literal is
# stored in the repository.
recipient="age1$(printf 'q%.0s' $(seq 1 58))"
secret_identity="AGE-SECRET-KEY-1$(printf 'Q%.0s' $(seq 1 58))"
canary="canary$(date +%s)secret"

# expect NAME STATUS PATTERN -- command...: the command exits with STATUS, its output matches
# PATTERN (grep -E) and never contains the canary secret.
expect() {
  name="$1"
  want_status="$2"
  pattern="$3"
  shift 4
  set +e
  "$@" >"${out_file}" 2>&1
  status=$?
  set -e
  problem=""
  [ "${status}" = "${want_status}" ] || problem="exit ${status}, expected ${want_status}"
  grep -Eq -- "${pattern}" "${out_file}" || problem="${problem}${problem:+; }output does not match /${pattern}/"
  if grep -q -- "${canary}" "${out_file}"; then problem="${problem}${problem:+; }a secret value was printed"; fi
  if [ -z "${problem}" ]; then
    passed=$((passed + 1))
    echo "ok   ${name}"
  else
    failed=$((failed + 1))
    echo "FAIL ${name}: ${problem}"
    sed 's/^/     | /' "${out_file}"
  fi
}

backup_env() {
  env -i PATH="${PATH}" \
    CETELE_BACKUP_AGE_RECIPIENT="${recipient}" \
    CETELE_BACKUP_S3_ENDPOINT="https://backup.example.test" \
    CETELE_BACKUP_S3_WRITE_ACCESS_KEY="writer" \
    CETELE_BACKUP_S3_WRITE_SECRET_KEY="${canary}" \
    "$@"
}

restore_env() {
  env -i PATH="${PATH}" \
    CETELE_BACKUP_S3_ENDPOINT="https://backup.example.test" \
    CETELE_RESTORE_S3_READ_ACCESS_KEY="reader" \
    CETELE_RESTORE_S3_READ_SECRET_KEY="${canary}" \
    CETELE_RESTORE_AGE_IDENTITY_FILE="${script_dir}/checks.test.sh" \
    CETELE_RESTORE_PG_DATABASE="restored" \
    "$@"
}

expect "backup: --help prints the usage" 0 'Daily logical backup' -- sh "${script_dir}/backup.sh" --help
expect "backup: unknown argument is refused" 2 'unknown argument' -- sh "${script_dir}/backup.sh" --now
missing_keys='CETELE_BACKUP_AGE_RECIPIENT, CETELE_BACKUP_S3_ENDPOINT, '
missing_keys="${missing_keys}CETELE_BACKUP_S3_WRITE_ACCESS_KEY, CETELE_BACKUP_S3_WRITE_SECRET_KEY"
expect "backup: missing environment names every key" 2 "${missing_keys}" -- \
  env -i PATH="${PATH}" sh "${script_dir}/backup.sh"
expect "backup: a private age identity is refused as recipient" 2 'holds a private identity' -- \
  backup_env CETELE_BACKUP_AGE_RECIPIENT="${secret_identity}" sh "${script_dir}/backup.sh"
expect "backup: a malformed recipient is refused" 2 'not an age X25519 recipient' -- \
  backup_env CETELE_BACKUP_AGE_RECIPIENT="age1short" sh "${script_dir}/backup.sh"
expect "backup: plain http to a remote endpoint is refused" 2 'must use https' -- \
  backup_env CETELE_BACKUP_S3_ENDPOINT="http://backup.example.test" sh "${script_dir}/backup.sh"
expect "backup: a key that is not URL-safe is refused" 2 'CETELE_BACKUP_S3_WRITE_ACCESS_KEY may only contain' -- \
  backup_env CETELE_BACKUP_S3_WRITE_ACCESS_KEY="wri:ter" sh "${script_dir}/backup.sh"
expect "backup: an invalid bucket is refused without printing the secret" 2 'bucket name is not valid' -- \
  backup_env CETELE_BACKUP_S3_BUCKET="Not_A_Bucket" sh "${script_dir}/backup.sh"
expect "backup: a prefix without trailing slash is refused" 2 'prefix must be empty or end with' -- \
  backup_env CETELE_BACKUP_S3_PREFIX="cetele" sh "${script_dir}/backup.sh"
expect "backup: a database name with SQL is refused" 2 'CETELE_BACKUP_PG_DATABASE is not a plain PostgreSQL identifier' -- \
  backup_env CETELE_BACKUP_PG_DATABASE="cetele;drop" sh "${script_dir}/backup.sh"
expect "backup: a missing age binary is reported" 2 'required tool not found: ./no-such-age' -- \
  backup_env CETELE_BACKUP_AGE_BIN="./no-such-age" sh "${script_dir}/backup.sh"

expect "restore: --help prints the usage" 0 'Restore an encrypted Cetele dump' -- sh "${script_dir}/restore.sh" --help
expect "restore: missing environment names every key" 2 'CETELE_RESTORE_AGE_IDENTITY_FILE, CETELE_RESTORE_PG_DATABASE' -- \
  env -i PATH="${PATH}" sh "${script_dir}/restore.sh"
expect "restore: a missing identity file is refused" 2 'CETELE_RESTORE_AGE_IDENTITY_FILE is not a file' -- \
  restore_env CETELE_RESTORE_AGE_IDENTITY_FILE="${script_dir}/no-such-identity.txt" sh "${script_dir}/restore.sh"
expect "restore: an object key outside the dump pattern is refused" 2 'CETELE_RESTORE_OBJECT is not a dump key' -- \
  restore_env CETELE_RESTORE_OBJECT="cetele/../other.dump" sh "${script_dir}/restore.sh"
expect "restore: a target name with SQL is refused" 2 'CETELE_RESTORE_PG_DATABASE is not a plain PostgreSQL identifier' -- \
  restore_env CETELE_RESTORE_PG_DATABASE="restored;drop" sh "${script_dir}/restore.sh"

expect "restore-drill: --help prints the usage" 0 'Restore drill' -- sh "${script_dir}/restore-drill.sh" --help
expect "restore-drill: an empty expected file is refused" 2 'CETELE_DRILL_EXPECTED is not a non-empty file' -- \
  restore_env CETELE_DRILL_EXPECTED="${out_file}.missing" sh "${script_dir}/restore-drill.sh"

endpoint_check() {
  sh -c '. "$1/lib.sh"; check_endpoint endpoint "$2" "$3"; echo accepted' sh "${script_dir}" "$1" "$2"
}

expect "endpoint: localhost suffix is remote" 2 'must use https' -- endpoint_check 'http://localhost.example.com' ''
expect "endpoint: numeric loopback suffix is remote" 2 'must use https' -- endpoint_check 'http://127.0.0.1.example.com' ''
expect "endpoint: docker host suffix is remote" 2 'must use https' -- endpoint_check 'http://host.docker.internal.evil.com' ''
expect "endpoint: dotted remote host is refused with network" 2 'must use https' -- endpoint_check 'http://evil.com' 'backup'
expect "endpoint: single label needs network" 2 'must use https' -- endpoint_check 'http://minio:9000' ''
expect "endpoint: single label with network" 0 'accepted' -- endpoint_check 'http://minio:9000' 'backup'
expect "endpoint: loopback with port" 0 'accepted' -- endpoint_check 'http://localhost:9000' ''
expect "endpoint: numeric loopback" 0 'accepted' -- endpoint_check 'http://127.0.0.1:9000' ''
expect "endpoint: IPv6 loopback" 0 'accepted' -- endpoint_check 'http://[::1]:9000' ''
expect "endpoint: docker host" 0 'accepted' -- endpoint_check 'http://host.docker.internal:9000' ''
expect "endpoint: secure remote host" 0 'accepted' -- endpoint_check 'https://backup.example.test' ''
expect "endpoint: user info is refused" 2 'must not contain user info' -- endpoint_check 'http://u:p@localhost' ''
expect "endpoint: secure user info is refused" 2 'must not contain user info' -- endpoint_check 'https://u:p@evil.com' ''
expect "endpoint: missing host is refused" 2 'must have a host' -- endpoint_check 'https:///dump' ''
expect "endpoint: malformed port is refused" 2 'invalid port' -- endpoint_check 'http://localhost:bad' ''

echo "checks: ${passed} passed, ${failed} failed"
[ "${failed}" -eq 0 ]
