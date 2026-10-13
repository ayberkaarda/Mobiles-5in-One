#!/usr/bin/env bash
# Restore an encrypted Inecek Var dump into an empty PostGIS database (security checklist item
# 20, docs/ops/backup-restore.md).
#
#   1. pick the object: INECEKVAR_RESTORE_OBJECT, or the newest
#      <prefix>inecekvar-*.dump.age listed by the read-only restore identity (names carry a UTC
#      timestamp, so the newest sorts last)
#   2. download it and its .sha256 sidecar, refuse a checksum mismatch or a file that is not age
#   3. refuse a target database that already holds tables in schema public
#   4. age -d with the identity | pg_restore --no-owner --exit-on-error (the plain dump never
#      touches the disk); a wrong identity stops here with a FAIL line
#   5. remove the downloaded file and any identity copy
#
# The restored database holds every account as of the dump. Deletion requests recorded after
# the dump must be replayed before the worker starts: replay-deletions.sh and the runbook.
#
# Usage: ops/backup/restore.sh [--help]
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

while [ "$#" -gt 0 ]; do
  case "$1" in
    -h | --help)
      usage
      exit 0
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
    "${work_dir}/restore.err"
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
