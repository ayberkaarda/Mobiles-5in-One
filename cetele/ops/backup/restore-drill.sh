#!/bin/sh
# Restore drill: the newest encrypted dump into a throwaway PostgreSQL (security checklist item 20,
# docs/ops/backup-restore.md).
#
#   1. start a disposable PostgreSQL 16 container (no published port, no volume)
#   2. restore.sh: newest dump from the bucket with the read-only identity, checksum, age -d,
#      pg_restore into a new database
#   3. fingerprint the restored database with drill-stats.sql (exact row count per table and the
#      ledger balance checksum) and check drill-invariants.sql (every count 0)
#   4. with CETELE_DRILL_EXPECTED, compare the fingerprint line by line with the one taken from
#      the source database before the backup; any difference fails the drill
#   5. remove the container by its exact name (also on failure or interrupt)
#
# Usage: ops/backup/restore-drill.sh [--help]
#
# Required environment: as restore.sh (CETELE_BACKUP_S3_ENDPOINT, CETELE_RESTORE_S3_READ_ACCESS_KEY,
# CETELE_RESTORE_S3_READ_SECRET_KEY, CETELE_RESTORE_AGE_IDENTITY_FILE); the target database is
# the drill container, so the CETELE_RESTORE_PG_* keys are set here.
# Optional:
#   CETELE_DRILL_EXPECTED   fingerprint file of the source (drill-stats.sql output). Without it
#                           the drill checks invariants only and says so in its RESULT line.
#   CETELE_DRILL_PG_IMAGE   default postgres:16.15-alpine (the image of docker-compose.yml)
#   CETELE_RESTORE_OBJECT, CETELE_BACKUP_S3_BUCKET, CETELE_BACKUP_S3_PREFIX,
#   CETELE_BACKUP_MC_IMAGE, CETELE_BACKUP_DOCKER_NETWORK, CETELE_BACKUP_AGE_BIN: as restore.sh
#
# Exit codes: 0 drill passed, 1 a step or check failed, 2 usage or configuration error.
set -eu
set +x
umask 077

ops_name="restore-drill"
script_dir="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
# shellcheck source=lib.sh
. "${script_dir}/lib.sh"

usage() {
  sed -n '2,/^set -eu$/p' "$0" | sed -e '$d' -e 's/^# \{0,1\}//'
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    -h | --help)
      usage
      exit 0
      ;;
    *) die_config "unknown argument: $1 (see --help)" ;;
  esac
done

require_env CETELE_BACKUP_S3_ENDPOINT CETELE_RESTORE_S3_READ_ACCESS_KEY CETELE_RESTORE_S3_READ_SECRET_KEY \
  CETELE_RESTORE_AGE_IDENTITY_FILE
expected="${CETELE_DRILL_EXPECTED:-}"
if [ -n "${expected}" ] && [ ! -s "${expected}" ]; then
  die_config "CETELE_DRILL_EXPECTED is not a non-empty file"
fi
pg_image="${CETELE_DRILL_PG_IMAGE:-${CETELE_OPS_PG_IMAGE_DEFAULT}}"
require_tool docker

run_id="$(date +%s)-$$"
db_container="cetele-restore-drill-${run_id}"
db_user="drill"
work_dir="$(mktemp -d)"

cleanup() {
  status=$?
  docker rm -f "${db_container}" >/dev/null 2>&1 || true
  rm -f "${work_dir}/actual.txt" "${work_dir}/invariants.txt"
  rmdir "${work_dir}" 2>/dev/null || true
  echo "cleanup: removed container ${db_container}"
  exit "${status}"
}
trap cleanup EXIT
trap 'exit 1' INT TERM

echo "== step 1: start a throwaway database (${pg_image})"
# Throwaway password: the container publishes no port and is removed at the end.
docker run -d --name "${db_container}" \
  -e POSTGRES_USER="${db_user}" -e POSTGRES_PASSWORD="drill-scratch-only" -e POSTGRES_DB=postgres \
  "${pg_image}" >/dev/null
ready=0
for _ in $(seq 1 90); do
  # Only the final server listens on TCP; the init-time server uses the socket only.
  if docker exec "${db_container}" pg_isready -h 127.0.0.1 -U "${db_user}" -d postgres >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
[ "${ready}" -eq 1 ] || fail "database container did not become ready"
psql_at "${db_container}" "${db_user}" postgres -c "CREATE DATABASE restored TEMPLATE template0;"
echo "server: $(psql_at "${db_container}" "${db_user}" postgres -c 'SHOW server_version;')"

echo "== step 2: restore the newest dump"
CETELE_RESTORE_PG_CONTAINER="${db_container}" CETELE_RESTORE_PG_USER="${db_user}" CETELE_RESTORE_PG_DATABASE=restored \
  sh "${script_dir}/restore.sh" || fail "restore.sh failed"

echo "== step 3: fingerprint and invariants"
psql_at "${db_container}" "${db_user}" restored <"${script_dir}/drill-stats.sql" | tr -d '\r' >"${work_dir}/actual.txt"
cat "${work_dir}/actual.txt"
entries="$(sed -n 's/^rows ledger_entries \([0-9]*\)$/\1/p' "${work_dir}/actual.txt")"
customers="$(sed -n 's/^rows customers \([0-9]*\)$/\1/p' "${work_dir}/actual.txt")"
[ -n "${entries}" ] && [ "${entries}" -gt 0 ] || fail "the restored database has no ledger entries"
[ -n "${customers}" ] && [ "${customers}" -gt 0 ] || fail "the restored database has no customers"
grep -q '^ledger_balance shops=[0-9]* total=-\{0,1\}[0-9]* sha256=[0-9a-f]\{64\}$' "${work_dir}/actual.txt" ||
  fail "no ledger balance checksum line"
psql_at "${db_container}" "${db_user}" restored <"${script_dir}/drill-invariants.sql" | tr -d '\r' >"${work_dir}/invariants.txt"
cat "${work_dir}/invariants.txt"
if grep -v ' 0$' "${work_dir}/invariants.txt" >/dev/null; then
  fail "a ledger invariant is violated in the restored database"
fi
echo "invariants: hold"

if [ -n "${expected}" ]; then
  echo "== step 4: compare with the source fingerprint"
  if ! tr -d '\r' <"${expected}" | diff - "${work_dir}/actual.txt"; then
    fail "the restored fingerprint differs from the source (lines above: < source, > restored)"
  fi
  echo "row counts and ledger balance checksum: identical to the source ($(wc -l <"${work_dir}/actual.txt" | tr -d ' ') lines)"
  echo "RESULT: restore drill passed"
else
  echo "== step 4: compare with the source fingerprint"
  echo "not exercised: CETELE_DRILL_EXPECTED not set"
  echo "RESULT: restore drill passed without a source comparison"
fi
