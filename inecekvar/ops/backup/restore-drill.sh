#!/usr/bin/env bash
# Restore drill: the newest encrypted dump into a throwaway PostGIS database, then the restore
# checks (security checklist items 20 and 21, docs/ops/backup-restore.md).
#
#   1. start a disposable PostgreSQL 16 with PostGIS (no published port, no volume)
#   2. restore.sh: newest dump with the read-only identity, checksum, age -d, pg_restore into a
#      new database created from template0
#   3. checks, one table row each, all run before the verdict:
#        alembic_head                      restored alembic_version = head of api/alembic
#        drill-checks.sql rules            published lines present, valid geometry, at least two
#                                          stops in the line's city, TOTP secrets still
#                                          ciphertext, scheduled deletions keep their effects
#        required_tables_not_empty         the tables named in INECEKVAR_DRILL_REQUIRED_TABLES
#        fingerprint_matches_source        row count of every table and content digests equal
#                                          the source fingerprint (INECEKVAR_DRILL_EXPECTED)
#        deletions_after_dump_reapplied    replay-deletions.sh with INECEKVAR_DRILL_DELETIONS:
#                                          every request recorded after the dump is re-applied
#                                          and verified (or cancelled), one state line per list
#                                          line; a failing replay fails the drill, an empty list
#                                          is a skip
#   4. print the table; any FAIL fails the drill
#   5. remove the container by its exact name (also on failure or interrupt)
#
# Usage: ops/backup/restore-drill.sh [--help]
#
# Required environment: as restore.sh (INECEKVAR_BACKUP_S3_ENDPOINT, the read-only identity, and
# INECEKVAR_RESTORE_AGE_IDENTITY_FILE or INECEKVAR_RESTORE_AGE_IDENTITY); the target database is
# the drill container, so the INECEKVAR_RESTORE_PG_* keys are set here.
# Optional:
#   INECEKVAR_DRILL_EXPECTED         source fingerprint (drill-stats.sql output). Without it the
#                                    comparison row says skip and the RESULT line says so.
#   INECEKVAR_DRILL_DELETIONS        deletion requests recorded after the dump (format of
#                                    replay-deletions.sh). Without it the replay row says skip.
#   INECEKVAR_DRILL_CANCELLATIONS    deletion cancellations recorded after the dump (format of
#                                    replay-deletions.sh), optional
#   INECEKVAR_DRILL_REPLAY           1 (default) re-applies missing requests; 0 only flags them
#   INECEKVAR_DRILL_REQUIRED_TABLES  space-separated, default
#                                    "alembic_version cities stops lines line_versions line_stops users"
#   INECEKVAR_DRILL_EXPECTED_HEAD    Alembic head to expect, default computed from api/alembic
#   INECEKVAR_DRILL_PG_IMAGE         default postgis/postgis:16-3.5 (the image of docker-compose.yml)
#   INECEKVAR_RESTORE_OBJECT, INECEKVAR_BACKUP_S3_BUCKET, INECEKVAR_BACKUP_S3_PREFIX,
#   INECEKVAR_BACKUP_MC_IMAGE, INECEKVAR_BACKUP_DOCKER_NETWORK, INECEKVAR_BACKUP_AGE_BIN: as
#   restore.sh
#
# Exit codes: 0 drill passed, 1 a step or check failed, 2 usage or configuration error.
set -euo pipefail
set +x
umask 077

ops_name="restore-drill"
script_dir="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
# shellcheck source=lib.sh
. "${script_dir}/lib.sh"

usage() {
  sed -n '2,/^set -euo pipefail$/p' "$0" | sed -e '$d' -e 's/^# \{0,1\}//'
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

require_env INECEKVAR_BACKUP_S3_ENDPOINT INECEKVAR_RESTORE_S3_READ_ACCESS_KEY INECEKVAR_RESTORE_S3_READ_SECRET_KEY
expected="${INECEKVAR_DRILL_EXPECTED:-}"
deletions="${INECEKVAR_DRILL_DELETIONS:-}"
cancellations="${INECEKVAR_DRILL_CANCELLATIONS:-}"
replay="${INECEKVAR_DRILL_REPLAY:-1}"
required_tables="${INECEKVAR_DRILL_REQUIRED_TABLES:-alembic_version cities stops lines line_versions line_stops users}"
expected_head="${INECEKVAR_DRILL_EXPECTED_HEAD:-}"
pg_image="${INECEKVAR_DRILL_PG_IMAGE:-${INECEKVAR_OPS_PG_IMAGE_DEFAULT}}"
if [ -n "${expected}" ] && [ ! -s "${expected}" ]; then
  die_config "INECEKVAR_DRILL_EXPECTED is not a non-empty file"
fi
if [ -n "${deletions}" ] && [ ! -f "${deletions}" ]; then
  die_config "INECEKVAR_DRILL_DELETIONS is not a file"
fi
if [ -n "${cancellations}" ] && [ ! -f "${cancellations}" ]; then
  die_config "INECEKVAR_DRILL_CANCELLATIONS is not a file"
fi
for table in ${required_tables}; do
  check_identifier INECEKVAR_DRILL_REQUIRED_TABLES "${table}"
done
if [ -z "${expected_head}" ]; then
  expected_head="$(alembic_head_of "${script_dir}/../../api/alembic/versions")" ||
    die_config "cannot find a single Alembic head under api/alembic/versions; set INECEKVAR_DRILL_EXPECTED_HEAD"
fi
require_tool docker

run_id="$(date +%s)-$$"
db_container="inecekvar-restore-drill-${run_id}"
db_user="drill"
work_dir="$(mktemp -d)"
check_table="${work_dir}/checks.tsv"
: >"${check_table}"

cleanup() {
  local status=$?
  docker rm -f "${db_container}" >/dev/null 2>&1 || true
  rm -f "${work_dir}"/*.txt "${check_table}"
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
for _ in $(seq 1 120); do
  # Only the final server listens on TCP; the init-time server uses the socket only.
  if docker exec "${db_container}" pg_isready -h 127.0.0.1 -U "${db_user}" -d postgres >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
[ "${ready}" -eq 1 ] || fail "database container did not become ready"
psql_at "${db_container}" "${db_user}" postgres -c "CREATE DATABASE restored TEMPLATE template0;"
echo "server: PostgreSQL $(psql_at "${db_container}" "${db_user}" postgres -c 'SHOW server_version;')"

echo "== step 2: restore the newest dump"
INECEKVAR_RESTORE_PG_CONTAINER="${db_container}" INECEKVAR_RESTORE_PG_USER="${db_user}" \
  INECEKVAR_RESTORE_PG_DATABASE=restored INECEKVAR_RESTORE_PICKED_FILE="${work_dir}/picked.txt" \
  bash "${script_dir}/restore.sh" || fail "restore.sh failed"
object="$(cat "${work_dir}/picked.txt")"

echo "== step 3: checks"
restored_head="$(psql_at "${db_container}" "${db_user}" restored -c 'SELECT version_num FROM alembic_version ORDER BY 1;' | tr -d '\r')" ||
  restored_head=""
check_alembic_head "${expected_head}" "${restored_head}" || true

psql_at "${db_container}" "${db_user}" restored <"${script_dir}/drill-checks.sql" | tr -d '\r' >"${work_dir}/rules.txt" ||
  fail "drill-checks.sql could not run on the restored database"
check_rules "${work_dir}/rules.txt" published_lines_present published_line_geometry_valid \
  published_line_at_least_2_stops published_line_stops_in_city totp_secret_still_ciphertext \
  scheduled_deletions_keep_immediate_effects || true

psql_at "${db_container}" "${db_user}" restored <"${script_dir}/drill-stats.sql" | tr -d '\r' >"${work_dir}/actual.txt" ||
  fail "drill-stats.sql could not run on the restored database"
# shellcheck disable=SC2086 # the table list is a space-separated set of checked identifiers
check_required_tables "${work_dir}/actual.txt" ${required_tables} || true

if [ -n "${expected}" ]; then
  if ! check_fingerprint "${expected}" "${work_dir}/actual.txt"; then
    echo "fingerprint differences (< source, > restored):"
    diff <(tr -d '\r' <"${expected}") "${work_dir}/actual.txt" || true
  fi
else
  check_record fingerprint_matches_source skip "INECEKVAR_DRILL_EXPECTED not set"
fi

if [ -n "${deletions}" ]; then
  echo "dump time: $(dump_stamp_iso "${object}")"
  # The exit status is part of the check: a replay that dies half-way must fail the drill even
  # when the lines it wrote before dying are all good (phase 6 review F4).
  set +e
  INECEKVAR_REPLAY_DELETIONS_FILE="${deletions}" INECEKVAR_REPLAY_APPLY="${replay}" \
    INECEKVAR_REPLAY_CANCELLATIONS_FILE="${cancellations}" \
    INECEKVAR_REPLAY_STATE_FILE="${work_dir}/replay.txt" \
    INECEKVAR_RESTORE_PG_CONTAINER="${db_container}" INECEKVAR_RESTORE_PG_USER="${db_user}" \
    INECEKVAR_RESTORE_PG_DATABASE=restored bash "${script_dir}/replay-deletions.sh"
  replay_status=$?
  set -e
  [ -f "${work_dir}/replay.txt" ] || : >"${work_dir}/replay.txt"
  check_deletion_replay "${work_dir}/replay.txt" "${deletions}" "${replay_status}" || true
else
  check_record deletions_after_dump_reapplied skip "INECEKVAR_DRILL_DELETIONS not set"
fi

echo "== step 4: result for ${object}"
check_print_table
failures="$(check_failures)"
[ "${failures}" = "0" ] || fail "${failures} restore checks failed (table above)"
if grep -q "$(printf '\tskip\t')" "${check_table}"; then
  echo "RESULT: restore drill passed with skipped checks (see table)"
else
  echo "RESULT: restore drill passed"
fi
