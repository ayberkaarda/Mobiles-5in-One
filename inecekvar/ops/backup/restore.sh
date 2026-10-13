#!/usr/bin/env bash
# Restore an encrypted Inecek Var dump into an empty PostGIS database (security checklist item
# 20, docs/ops/backup-restore.md).
#
#   1. pick the object: INECEKVAR_RESTORE_OBJECT, or the newest
#      <prefix>inecekvar-*.dump.age listed by the read-only restore identity (names carry a UTC
#      timestamp, so the newest sorts last); refuse it when its name stamp lies in the future or
#      far from its LastModified time (a planted or overwritten dump, ADR-0053 decision 11),
#      print it with its LastModified time and, unless the target is the drill container, ask
#      for confirmation (or take --yes)
#   2. download it and its .sha256 sidecar, refuse a checksum mismatch or a file that is not age
#   3. refuse a target database that already holds tables in schema public
#   4. age -d with the identity | pg_restore --no-owner --exit-on-error (the plain dump never
#      touches the disk); a wrong identity stops here with a FAIL line
#   5. remove the downloaded file and any identity copy
#
# The restored database holds every account as of the dump. Deletion requests recorded after
# the dump must be replayed before the worker starts: replay-deletions.sh and the runbook.
#
# Usage: ops/backup/restore.sh [--yes] [--help]
#   --yes   restore without the interactive confirmation (needed when the target is not the
#           drill container and stdin is not a terminal)
#
# Required environment:
#   INECEKVAR_BACKUP_S3_ENDPOINT           S3 API endpoint (rules as in backup.sh)
#   INECEKVAR_RESTORE_S3_READ_ACCESS_KEY   read-only identity of the backup bucket (list, get)
#   INECEKVAR_RESTORE_S3_READ_SECRET_KEY
#   INECEKVAR_RESTORE_PG_DATABASE          target database; it must exist and be empty
# Age identity (the private key), exactly one of:
#   INECEKVAR_RESTORE_AGE_IDENTITY_FILE    path of the identity file; read by age only
#   INECEKVAR_RESTORE_AGE_IDENTITY         the identity text (AGE-SECRET-KEY-1...); written to a
#                                          0600 temp file for age and removed at exit
# Target, one of:
#   INECEKVAR_RESTORE_PG_CONTAINER         container running PostgreSQL 16 with PostGIS
#   (unset)                                psql and pg_restore 16 on PATH with the libpq
#                                          environment
# Optional:
#   INECEKVAR_RESTORE_OBJECT       object key to restore instead of the newest
#   INECEKVAR_RESTORE_PG_USER      default inecekvar (container mode)
#   INECEKVAR_BACKUP_S3_BUCKET     default inecekvar-backups
#   INECEKVAR_BACKUP_S3_PREFIX     default inecekvar/
#   INECEKVAR_BACKUP_MC_IMAGE, INECEKVAR_BACKUP_DOCKER_NETWORK, INECEKVAR_BACKUP_AGE_BIN: as
#   backup.sh
#   INECEKVAR_RESTORE_PICKED_FILE  file to receive the restored object key (used by the drill)
#   INECEKVAR_RESTORE_MAX_SKEW_HOURS  largest allowed distance between the name stamp and the
#                                  LastModified time, default 6
#   INECEKVAR_RESTORE_FUTURE_MINUTES  clock tolerance for a name stamp ahead of now, default 10
#
# No shell tracing; credentials and the identity are never printed. Exit codes: 0 restored,
# 1 a step failed, 2 usage or configuration error.
set -euo pipefail
set +x
umask 077

ops_name="restore"
script_dir="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
# shellcheck source=lib.sh
. "${script_dir}/lib.sh"

usage() {
  sed -n '2,/^set -euo pipefail$/p' "$0" | sed -e '$d' -e 's/^# \{0,1\}//'
}

assume_yes=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    -h | --help)
      usage
      exit 0
      ;;
    --yes)
      assume_yes=1
      shift
      ;;
    *) die_config "unknown argument: $1 (see --help)" ;;
  esac
done

require_env INECEKVAR_BACKUP_S3_ENDPOINT INECEKVAR_RESTORE_S3_READ_ACCESS_KEY \
  INECEKVAR_RESTORE_S3_READ_SECRET_KEY INECEKVAR_RESTORE_PG_DATABASE

endpoint="${INECEKVAR_BACKUP_S3_ENDPOINT}"
network="${INECEKVAR_BACKUP_DOCKER_NETWORK:-}"
bucket="${INECEKVAR_BACKUP_S3_BUCKET:-${INECEKVAR_OPS_BUCKET_DEFAULT}}"
prefix="${INECEKVAR_BACKUP_S3_PREFIX-${INECEKVAR_OPS_PREFIX_DEFAULT}}"
mc_image="${INECEKVAR_BACKUP_MC_IMAGE-${INECEKVAR_OPS_MC_IMAGE_DEFAULT}}"
age_bin="${INECEKVAR_BACKUP_AGE_BIN:-age}"
identity_file="${INECEKVAR_RESTORE_AGE_IDENTITY_FILE:-}"
identity_text="${INECEKVAR_RESTORE_AGE_IDENTITY:-}"
pg_container="${INECEKVAR_RESTORE_PG_CONTAINER:-}"
pg_database="${INECEKVAR_RESTORE_PG_DATABASE}"
pg_user="${INECEKVAR_RESTORE_PG_USER:-inecekvar}"
object="${INECEKVAR_RESTORE_OBJECT:-}"
picked_file="${INECEKVAR_RESTORE_PICKED_FILE:-}"
max_skew_hours="${INECEKVAR_RESTORE_MAX_SKEW_HOURS:-6}"
future_minutes="${INECEKVAR_RESTORE_FUTURE_MINUTES:-10}"

check_endpoint INECEKVAR_BACKUP_S3_ENDPOINT "${endpoint}" "${network}"
check_bucket "${bucket}"
check_prefix "${prefix}"
check_url_safe INECEKVAR_RESTORE_S3_READ_ACCESS_KEY "${INECEKVAR_RESTORE_S3_READ_ACCESS_KEY}"
check_url_safe INECEKVAR_RESTORE_S3_READ_SECRET_KEY "${INECEKVAR_RESTORE_S3_READ_SECRET_KEY}"
check_identifier INECEKVAR_RESTORE_PG_DATABASE "${pg_database}"
check_identifier INECEKVAR_RESTORE_PG_USER "${pg_user}"
if [ -n "${identity_file}" ] && [ -n "${identity_text}" ]; then
  die_config "set INECEKVAR_RESTORE_AGE_IDENTITY_FILE or INECEKVAR_RESTORE_AGE_IDENTITY, not both"
elif [ -n "${identity_file}" ]; then
  [ -f "${identity_file}" ] || die_config "INECEKVAR_RESTORE_AGE_IDENTITY_FILE is not a file"
elif [ -n "${identity_text}" ]; then
  case "${identity_text}" in
    *AGE-SECRET-KEY-1*) ;;
    *) die_config "INECEKVAR_RESTORE_AGE_IDENTITY does not hold an age identity (AGE-SECRET-KEY-1...)" ;;
  esac
else
  die_config "refusing to run, missing environment: INECEKVAR_RESTORE_AGE_IDENTITY_FILE or INECEKVAR_RESTORE_AGE_IDENTITY"
fi
if [ -n "${object}" ] && ! [[ "${object}" =~ ^([A-Za-z0-9._-]+/)*${INECEKVAR_OPS_DUMP_RE}$ ]]; then
  die_config "INECEKVAR_RESTORE_OBJECT is not a dump key (<prefix>inecekvar-<YYYYMMDDTHHMMSSZ>.dump.age)"
fi
[[ "${max_skew_hours}" =~ ^[0-9]{1,3}$ ]] && [ "${max_skew_hours}" -ge 1 ] ||
  die_config "INECEKVAR_RESTORE_MAX_SKEW_HOURS must be a whole number of hours from 1 to 999"
[[ "${future_minutes}" =~ ^[0-9]{1,3}$ ]] ||
  die_config "INECEKVAR_RESTORE_FUTURE_MINUTES must be a whole number of minutes from 0 to 999"
# Only the restore drill's own throwaway container restores without a confirmation.
drill_target=0
case "${pg_container}" in
  inecekvar-restore-drill-*) drill_target=1 ;;
esac
if [ "${drill_target}" = "0" ] && [ "${assume_yes}" = "0" ] && [ ! -t 0 ]; then
  die_config "the target ${pg_database} is not the drill container: pass --yes, or run from a terminal to confirm the chosen dump"
fi
require_tool "${age_bin}"
if [ -n "${pg_container}" ]; then
  check_container_name INECEKVAR_RESTORE_PG_CONTAINER "${pg_container}"
  require_tool docker
else
  require_tool psql
  require_tool pg_restore
fi
if [ -n "${mc_image}" ]; then require_tool docker; else require_tool mc; fi

work_dir="$(mktemp -d)"
encrypted="${work_dir}/dump.age"
cleanup() {
  local status=$?
  rm -f "${encrypted}" "${work_dir}/dump.sha256" "${work_dir}/listing.json" "${work_dir}/identity.txt" \
    "${work_dir}/restore.err" "${work_dir}/stat.json"
  rmdir "${work_dir}" 2>/dev/null || true
  exit "${status}"
}
trap cleanup EXIT
trap 'exit 1' INT TERM

if [ -n "${identity_text}" ]; then
  printf '%s\n' "${identity_text}" >"${work_dir}/identity.txt"
  identity_file="${work_dir}/identity.txt"
fi

mc_read() {
  mc_run r "${endpoint}" "${INECEKVAR_RESTORE_S3_READ_ACCESS_KEY}" "${INECEKVAR_RESTORE_S3_READ_SECRET_KEY}" \
    "${mc_image}" "${network}" -- "$@"
}

echo "== step 1: pick the dump"
if [ -z "${object}" ]; then
  mc_read ls --json "r/${bucket}/${prefix}" >"${work_dir}/listing.json" ||
    fail "cannot list s3://${bucket}/${prefix} with the restore identity"
  newest="$(newest_dump_key "${work_dir}/listing.json")"
  [ -n "${newest}" ] || fail "no dump under s3://${bucket}/${prefix}"
  count="$(grep -Eoc "\"key\":\"${INECEKVAR_OPS_DUMP_RE}\"" "${work_dir}/listing.json" || true)"
  object="${prefix}${newest}"
  echo "dumps listed: ${count}, newest: ${object}"
else
  echo "requested: ${object}"
fi
mc_read stat --json "r/${bucket}/${object}" >"${work_dir}/stat.json" ||
  fail "cannot read the metadata of ${object} with the restore identity"
modified="$(grep -Eo '"lastModified" *: *"[^"]*"' "${work_dir}/stat.json" | head -n 1 | sed -e 's/.*: *"//' -e 's/"$//')"
echo "chosen: ${object}, LastModified ${modified:-unknown}"
if problem="$(dump_time_problem "${object}" "${modified}" "$(date -u +%s)" "${max_skew_hours}" "${future_minutes}")"; then
  echo "dump time: name stamp and LastModified agree"
else
  fail "${problem}; investigate the bucket (planted or overwritten dump?) and set INECEKVAR_RESTORE_OBJECT to a dump you trust"
fi
if [ "${drill_target}" = "0" ] && [ "${assume_yes}" = "0" ]; then
  printf 'Restore %s into database %s? Type the database name to continue: ' "${object}" "${pg_database}"
  read -r answer || answer=""
  [ "${answer}" = "${pg_database}" ] || fail "not confirmed; nothing was restored"
fi
if [ -n "${picked_file}" ]; then printf '%s\n' "${object}" >"${picked_file}"; fi

echo "== step 2: download and check"
mc_read cat "r/${bucket}/${object}" >"${encrypted}" || fail "cannot download ${object} with the restore identity"
mc_read cat "r/${bucket}/${object}.sha256" >"${work_dir}/dump.sha256" || fail "cannot download ${object}.sha256"
expected="$(cut -d ' ' -f 1 <"${work_dir}/dump.sha256" | tr -d '\r\n')"
actual="$(sha256_of "${encrypted}")"
echo "downloaded: $(file_size "${encrypted}") bytes, sha256 ${actual}"
[[ "${expected}" =~ ^[0-9a-f]{64}$ ]] || fail "the checksum sidecar of ${object} holds no SHA-256"
[ "${expected}" = "${actual}" ] || fail "checksum mismatch: sidecar ${expected}, file ${actual}"
[ "$(head -c 21 "${encrypted}")" = "age-encryption.org/v1" ] || fail "${object} is not an age file"
echo "checksum: matches the sidecar"

echo "== step 3: check the target database ${pg_database}"
tables="$(psql_at "${pg_container}" "${pg_user}" "${pg_database}" -c "SELECT count(*) FROM pg_tables WHERE schemaname = 'public';")" ||
  fail "cannot connect to the target database ${pg_database}"
[ "${tables}" = "0" ] || fail "target database ${pg_database} already holds ${tables} tables in public; restore into a new database"
echo "target: empty"

echo "== step 4: age -d | pg_restore"
set +e
"${age_bin}" -d -i "$(native_path "${identity_file}")" <"${encrypted}" |
  pg_tool "${pg_container}" "${pg_user}" "${pg_database}" pg_restore --no-owner --exit-on-error --no-password \
    2>"${work_dir}/restore.err"
statuses=("${PIPESTATUS[@]}")
set -e
if [ "${statuses[0]}" != "0" ]; then
  fail "age could not decrypt ${object} (status ${statuses[0]}; wrong identity?)"
fi
if [ "${statuses[1]}" != "0" ]; then
  sed 's/^/pg_restore: /' "${work_dir}/restore.err" | head -n 20 >&2
  fail "pg_restore exited with status ${statuses[1]}"
fi
tables="$(psql_at "${pg_container}" "${pg_user}" "${pg_database}" -c "SELECT count(*) FROM pg_tables WHERE schemaname = 'public';")"
echo "restored tables in public: ${tables}"

echo "RESULT: restored ${object} into ${pg_database}"
