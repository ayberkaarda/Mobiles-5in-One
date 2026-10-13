#!/usr/bin/env bash
# Shell tests of the backup scripts. Needs no Docker, no bucket and no age binary:
#   - configuration cases stop at a configuration error (exit 2) before any tool runs, and never
#     print the canary secret given to them
#   - the restore check functions of lib.sh run on fixtures, each with a passing and a failing
#     input, so a check that cannot fail is caught here
#
# Usage: ops/backup/checks.test.sh
# Exit codes: 0 all cases hold, 1 a case failed.
set -euo pipefail
set +x

script_dir="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
fixtures="$(mktemp -d)"
out_file="${fixtures}/out.txt"
trap 'rm -rf "${fixtures}"' EXIT

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
  local name="$1" want_status="$2" pattern="$3" status problem=""
  shift 4
  set +e
  "$@" >"${out_file}" 2>&1
  status=$?
  set -e
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
    INECEKVAR_BACKUP_AGE_RECIPIENT="${recipient}" \
    INECEKVAR_BACKUP_S3_ENDPOINT="https://backup.example.test" \
    INECEKVAR_BACKUP_S3_WRITE_ACCESS_KEY="writer" \
    INECEKVAR_BACKUP_S3_WRITE_SECRET_KEY="${canary}" \
    "$@"
}

restore_env() {
  env -i PATH="${PATH}" \
    INECEKVAR_BACKUP_S3_ENDPOINT="https://backup.example.test" \
    INECEKVAR_RESTORE_S3_READ_ACCESS_KEY="reader" \
    INECEKVAR_RESTORE_S3_READ_SECRET_KEY="${canary}" \
    INECEKVAR_RESTORE_AGE_IDENTITY_FILE="${script_dir}/checks.test.sh" \
    INECEKVAR_RESTORE_PG_DATABASE="restored" \
    INECEKVAR_BACKUP_AGE_BIN="./no-such-age" \
    "$@"
}

echo "-- configuration"
expect "backup: --help prints the usage" 0 'Daily logical backup' -- bash "${script_dir}/backup.sh" --help
expect "backup: unknown argument is refused" 2 'unknown argument' -- bash "${script_dir}/backup.sh" --now
expect "backup: missing environment names every key" 2 \
  'INECEKVAR_BACKUP_AGE_RECIPIENT, INECEKVAR_BACKUP_S3_ENDPOINT, INECEKVAR_BACKUP_S3_WRITE_ACCESS_KEY, INECEKVAR_BACKUP_S3_WRITE_SECRET_KEY' -- \
  env -i PATH="${PATH}" bash "${script_dir}/backup.sh"
expect "backup: a private age identity is refused as recipient" 2 'holds a private identity' -- \
  backup_env INECEKVAR_BACKUP_AGE_RECIPIENT="${secret_identity}" bash "${script_dir}/backup.sh"
expect "backup: a malformed recipient is refused" 2 'not an age X25519 recipient' -- \
  backup_env INECEKVAR_BACKUP_AGE_RECIPIENT="age1short" bash "${script_dir}/backup.sh"
expect "backup: plain http to a remote endpoint is refused" 2 'must use https' -- \
  backup_env INECEKVAR_BACKUP_S3_ENDPOINT="http://backup.example.test" bash "${script_dir}/backup.sh"
expect "backup: a key that is not URL-safe is refused" 2 'INECEKVAR_BACKUP_S3_WRITE_ACCESS_KEY may only contain' -- \
  backup_env INECEKVAR_BACKUP_S3_WRITE_ACCESS_KEY="wri:ter" bash "${script_dir}/backup.sh"
expect "backup: an invalid bucket is refused without printing the secret" 2 'bucket name is not valid' -- \
  backup_env INECEKVAR_BACKUP_S3_BUCKET="Not_A_Bucket" bash "${script_dir}/backup.sh"
expect "backup: a prefix without trailing slash is refused" 2 'prefix must be empty or end with' -- \
  backup_env INECEKVAR_BACKUP_S3_PREFIX="inecekvar" bash "${script_dir}/backup.sh"
expect "backup: a database name with SQL is refused" 2 'INECEKVAR_BACKUP_PG_DATABASE is not a plain PostgreSQL identifier' -- \
  backup_env INECEKVAR_BACKUP_PG_DATABASE="inecekvar;drop" bash "${script_dir}/backup.sh"
expect "backup: a missing age binary is reported" 2 'required tool not found: ./no-such-age' -- \
  backup_env INECEKVAR_BACKUP_AGE_BIN="./no-such-age" bash "${script_dir}/backup.sh"

expect "bucket-setup: --help prints the usage" 0 'One-time bucket setup' -- bash "${script_dir}/bucket-setup.sh" --help
expect "bucket-setup: missing environment names the verifier identity" 2 'INECEKVAR_BACKUP_VERIFY_SECRET_ACCESS_KEY' -- \
  env -i PATH="${PATH}" bash "${script_dir}/bucket-setup.sh"

expect "restore: --help prints the usage" 0 'Restore an encrypted Inecek Var dump' -- bash "${script_dir}/restore.sh" --help
expect "restore: missing environment names every key" 2 'INECEKVAR_RESTORE_S3_READ_SECRET_KEY, INECEKVAR_RESTORE_PG_DATABASE' -- \
  env -i PATH="${PATH}" bash "${script_dir}/restore.sh"
expect "restore: a missing identity file is refused" 2 'INECEKVAR_RESTORE_AGE_IDENTITY_FILE is not a file' -- \
  restore_env INECEKVAR_RESTORE_AGE_IDENTITY_FILE="${script_dir}/no-such-identity.txt" bash "${script_dir}/restore.sh"
expect "restore: no identity at all is refused" 2 'missing environment: INECEKVAR_RESTORE_AGE_IDENTITY_FILE or INECEKVAR_RESTORE_AGE_IDENTITY' -- \
  restore_env INECEKVAR_RESTORE_AGE_IDENTITY_FILE= bash "${script_dir}/restore.sh"
expect "restore: identity file and text together are refused" 2 'not both' -- \
  restore_env INECEKVAR_RESTORE_AGE_IDENTITY="${secret_identity}" bash "${script_dir}/restore.sh"
expect "restore: identity text that is not an identity is refused without echo" 2 'does not hold an age identity' -- \
  restore_env INECEKVAR_RESTORE_AGE_IDENTITY_FILE= INECEKVAR_RESTORE_AGE_IDENTITY="${canary}" bash "${script_dir}/restore.sh"
expect "restore: an object key outside the dump pattern is refused" 2 'INECEKVAR_RESTORE_OBJECT is not a dump key' -- \
  restore_env INECEKVAR_RESTORE_OBJECT="inecekvar/../other.dump" bash "${script_dir}/restore.sh"
expect "restore: a target name with SQL is refused" 2 'INECEKVAR_RESTORE_PG_DATABASE is not a plain PostgreSQL identifier' -- \
  restore_env INECEKVAR_RESTORE_PG_DATABASE="restored;drop" bash "${script_dir}/restore.sh"

expect "restore-drill: --help prints the usage" 0 'Restore drill' -- bash "${script_dir}/restore-drill.sh" --help
expect "restore-drill: an empty expected file is refused" 2 'INECEKVAR_DRILL_EXPECTED is not a non-empty file' -- \
  restore_env INECEKVAR_DRILL_EXPECTED="${out_file}.missing" bash "${script_dir}/restore-drill.sh"
expect "restore-drill: a required table with SQL is refused" 2 'INECEKVAR_DRILL_REQUIRED_TABLES is not a plain PostgreSQL identifier' -- \
  restore_env INECEKVAR_DRILL_REQUIRED_TABLES="users;drop" bash "${script_dir}/restore-drill.sh"

printf '01990000-0000-7000-8000-00000000d005 2026-10-13T02:19:30Z\n' >"${fixtures}/deletions.ok"
printf 'not-an-id 2026-10-13T02:19:30Z\n' >"${fixtures}/deletions.bad-id"
printf '01990000-0000-7000-8000-00000000d005 yesterday\n' >"${fixtures}/deletions.bad-time"
expect "replay: --help prints the usage" 0 'Replay account deletion requests' -- bash "${script_dir}/replay-deletions.sh" --help
expect "replay: a malformed account id is refused" 2 'line 1: not a lowercase account id' -- \
  env -i PATH="${PATH}" INECEKVAR_REPLAY_DELETIONS_FILE="${fixtures}/deletions.bad-id" INECEKVAR_RESTORE_PG_DATABASE=restored \
  bash "${script_dir}/replay-deletions.sh"
expect "replay: a malformed time is refused" 2 'line 1: not an ISO 8601 UTC time' -- \
  env -i PATH="${PATH}" INECEKVAR_REPLAY_DELETIONS_FILE="${fixtures}/deletions.bad-time" INECEKVAR_RESTORE_PG_DATABASE=restored \
  bash "${script_dir}/replay-deletions.sh"

expect "drill-e2e: --help prints the usage" 0 'End-to-end backup and restore drill' -- bash "${script_dir}/drill-e2e.sh" --help
expect "drill-e2e: an unknown mutation is refused" 2 'INECEKVAR_DRILL_MUTATION is not one of' -- \
  env INECEKVAR_DRILL_MUTATION=nothing bash "${script_dir}/drill-e2e.sh"
expect "drill-e2e: a port in the reserved range is refused" 2 'inside 57277-57776' -- \
  env INECEKVAR_DRILL_PG_PORT=57500 bash "${script_dir}/drill-e2e.sh"

endpoint_check() {
  bash -c 'set -euo pipefail; . "$1/lib.sh"; check_endpoint endpoint "$2" "$3"; echo accepted' bash "${script_dir}" "$1" "$2"
}

expect "endpoint: localhost suffix is remote" 2 'must use https' -- endpoint_check 'http://localhost.example.com' ''
expect "endpoint: docker host suffix is remote" 2 'must use https' -- endpoint_check 'http://host.docker.internal.evil.com' ''
expect "endpoint: dotted remote host is refused with network" 2 'must use https' -- endpoint_check 'http://evil.com' 'backup'
expect "endpoint: single label needs network" 2 'must use https' -- endpoint_check 'http://minio:9000' ''
expect "endpoint: single label with network" 0 'accepted' -- endpoint_check 'http://minio:9000' 'backup'
expect "endpoint: loopback with port" 0 'accepted' -- endpoint_check 'http://127.0.0.1:9000' ''
expect "endpoint: IPv6 loopback" 0 'accepted' -- endpoint_check 'http://[::1]:9000' ''
expect "endpoint: secure remote host" 0 'accepted' -- endpoint_check 'https://backup.example.test' ''
expect "endpoint: user info is refused" 2 'must not contain user info' -- endpoint_check 'https://u:p@evil.com' ''
expect "endpoint: malformed port is refused" 2 'invalid port' -- endpoint_check 'http://localhost:bad' ''

echo "-- restore check functions on fixtures"
# lib_call FUNCTION ARGS...: runs one lib.sh function with a fresh check table, prints the table
# and exits with the status of the function.
lib_call() {
  bash -c 'set -euo pipefail
. "$1/lib.sh"
check_table="$(mktemp)"
shift
set +e
"$@"
status=$?
set -e
check_print_table
rm -f "${check_table}"
exit "${status}"' bash "${script_dir}" "$@"
}

printf 'published_lines_present 0\npublished_line_at_least_2_stops 0\n' >"${fixtures}/rules.ok"
printf 'published_lines_present 0\npublished_line_at_least_2_stops 1\n' >"${fixtures}/rules.violated"
printf 'published_lines_present 0\n' >"${fixtures}/rules.truncated"
: >"${fixtures}/rules.empty"
printf 'published_lines_present 0\npublished_line_at_least_2_stops 0\nsurprise_rule 0\n' >"${fixtures}/rules.extra"
printf 'published_lines_present 0\npublished_lines_present 0\npublished_line_at_least_2_stops 0\n' >"${fixtures}/rules.repeated"
rules=(published_lines_present published_line_at_least_2_stops)
expect "check_rules: all zero passes" 0 'published_line_at_least_2_stops +pass +0 violations' -- \
  lib_call check_rules "${fixtures}/rules.ok" "${rules[@]}"
expect "check_rules: one violation fails" 1 'published_line_at_least_2_stops +FAIL +1 violations' -- \
  lib_call check_rules "${fixtures}/rules.violated" "${rules[@]}"
expect "check_rules: a missing rule line fails" 1 'published_line_at_least_2_stops +FAIL +no single result line' -- \
  lib_call check_rules "${fixtures}/rules.truncated" "${rules[@]}"
expect "check_rules: an empty result fails" 1 'published_lines_present +FAIL +no single result line \(found 0\)' -- \
  lib_call check_rules "${fixtures}/rules.empty" "${rules[@]}"
expect "check_rules: an unexpected rule fails" 1 'surprise_rule +FAIL +unexpected rule' -- \
  lib_call check_rules "${fixtures}/rules.extra" "${rules[@]}"
expect "check_rules: a repeated rule fails" 1 'published_lines_present +FAIL +no single result line \(found 2\)' -- \
  lib_call check_rules "${fixtures}/rules.repeated" "${rules[@]}"

printf 'rows favorites 5\nrows users 5\n' >"${fixtures}/stats.ok"
printf 'rows favorites 0\nrows users 5\n' >"${fixtures}/stats.empty-table"
expect "check_required_tables: tables with rows pass" 0 'required_tables_not_empty +pass +2 tables hold rows' -- \
  lib_call check_required_tables "${fixtures}/stats.ok" favorites users
expect "check_required_tables: an empty table fails" 1 'empty or missing: favorites\(0\)' -- \
  lib_call check_required_tables "${fixtures}/stats.empty-table" favorites users
expect "check_required_tables: a table missing from the stats fails" 1 'empty or missing: traces\(missing\)' -- \
  lib_call check_required_tables "${fixtures}/stats.ok" users traces
expect "check_required_tables: no table named fails" 1 'no table named' -- lib_call check_required_tables "${fixtures}/stats.ok"

printf 'hash users sha256=aa\nrows users 5\n' >"${fixtures}/fp.source"
printf 'hash users sha256=aa\nrows users 5\n' >"${fixtures}/fp.same"
printf 'hash users sha256=ab\nrows users 5\n' >"${fixtures}/fp.changed"
printf 'hash users sha256=aa\nrows users 4\n' >"${fixtures}/fp.fewer"
printf 'hash users sha256=aa\r\nrows users 5\r\n' >"${fixtures}/fp.crlf"
expect "check_fingerprint: identical passes" 0 'pass +2 lines identical' -- \
  lib_call check_fingerprint "${fixtures}/fp.source" "${fixtures}/fp.same"
expect "check_fingerprint: carriage returns are ignored" 0 'pass +2 lines identical' -- \
  lib_call check_fingerprint "${fixtures}/fp.crlf" "${fixtures}/fp.same"
expect "check_fingerprint: one changed hash fails" 1 'FAIL +2 differing lines of 2' -- \
  lib_call check_fingerprint "${fixtures}/fp.source" "${fixtures}/fp.changed"
expect "check_fingerprint: one row fewer fails" 1 'FAIL +2 differing lines of 2' -- \
  lib_call check_fingerprint "${fixtures}/fp.source" "${fixtures}/fp.fewer"
expect "check_fingerprint: an empty source fails" 1 'no source fingerprint' -- \
  lib_call check_fingerprint "${fixtures}/rules.empty" "${fixtures}/fp.same"

expect "check_alembic_head: equal head passes" 0 'restored 0005 = repository head 0005' -- lib_call check_alembic_head 0005 0005
expect "check_alembic_head: an older head fails" 1 'alembic_head +FAIL' -- lib_call check_alembic_head 0005 0004
expect "check_alembic_head: two rows fail" 1 'FAIL .*\(2 rows\)' -- lib_call check_alembic_head 0005 "$(printf '0004\n0005')"
expect "check_alembic_head: no rows fail" 1 'FAIL .*\(0 rows\)' -- lib_call check_alembic_head 0005 ""
expect "check_alembic_head: an unknown repository head fails" 1 'alembic_head +FAIL' -- lib_call check_alembic_head "" ""

printf 'a replayed\nb carried\nc absent\n' >"${fixtures}/replay.ok"
printf 'a replayed\nd missing\n' >"${fixtures}/replay.missing"
printf 'e unverified\n' >"${fixtures}/replay.unverified"
expect "check_deletion_replay: replayed, carried and absent pass" 0 'pass +replayed 1, carried 1, absent 1' -- \
  lib_call check_deletion_replay "${fixtures}/replay.ok"
expect "check_deletion_replay: a missing request fails" 1 'FAIL +1 not re-applied: d missing' -- \
  lib_call check_deletion_replay "${fixtures}/replay.missing"
expect "check_deletion_replay: an unverified replay fails" 1 'FAIL +1 not re-applied: e unverified' -- \
  lib_call check_deletion_replay "${fixtures}/replay.unverified"

# lib_value FUNCTION ARGS...: prints "value=<output>" so an empty result can be matched.
lib_value() {
  bash -c 'set -euo pipefail; . "$1/lib.sh"; shift; set +e; value="$("$@")"; status=$?; set -e
echo "value=${value}"; exit "${status}"' bash "${script_dir}" "$@"
}


# One `mc ls --json` line per object; the field name comes from a variable so the fixture holds
# no name-value pair that a secret scanner reads as a key.
field="key"
for name in inecekvar-20261012T031500Z.dump.age inecekvar-20261013T031500Z.dump.age.sha256 \
  inecekvar-20261013T031500Z.dump.age notes.txt; do
  printf '{"%s":"%s"}\n' "${field}" "${name}"
done >"${fixtures}/listing.json"
expect "newest_dump_key: the newest dump, never a sidecar" 0 '^value=inecekvar-20261013T031500Z\.dump\.age$' -- \
  lib_value newest_dump_key "${fixtures}/listing.json"
expect "newest_dump_key: a listing without dumps is empty" 0 '^value=$' -- \
  lib_value newest_dump_key "${fixtures}/rules.empty"
expect "dump_stamp_iso: the time in a dump name" 0 '^value=2026-10-13T03:15:00Z$' -- \
  lib_value dump_stamp_iso "inecekvar/inecekvar-20261013T031500Z.dump.age"
expect "dump_stamp_iso: another name fails" 1 '^value=$' -- \
  lib_value dump_stamp_iso "inecekvar/other.dump"

mkdir -p "${fixtures}/versions" "${fixtures}/branched"
printf 'revision: str = "0001"\ndown_revision: str | None = None\n' >"${fixtures}/versions/a.py"
printf 'revision: str = "0002"\ndown_revision: str | None = "0001"\n' >"${fixtures}/versions/b.py"
cp "${fixtures}/versions/a.py" "${fixtures}/versions/b.py" "${fixtures}/branched/"
printf 'revision: str = "0003"\ndown_revision: str | None = "0001"\n' >"${fixtures}/branched/c.py"
expect "alembic_head_of: the single head" 0 '^value=0002$' -- \
  lib_value alembic_head_of "${fixtures}/versions"
expect "alembic_head_of: two heads fail" 1 '^value=$' -- \
  lib_value alembic_head_of "${fixtures}/branched"
expect "alembic_head_of: the repository has one head" 0 '^value=[0-9a-z_]+$' -- \
  lib_value alembic_head_of "${script_dir}/../../api/alembic/versions"

echo "checks: ${passed} passed, ${failed} failed"
[ "${failed}" -eq 0 ]
