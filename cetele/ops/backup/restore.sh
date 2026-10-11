#!/bin/sh
# Restore an encrypted Cetele dump into an empty database (security checklist item 20,
# docs/ops/backup-restore.md).
#
#   1. pick the object: CETELE_RESTORE_OBJECT, or the newest <prefix>cetele-*.dump.age listed by
#      the read-only restore identity (names carry a UTC timestamp, so the newest sorts last)
#   2. download it and its .sha256 sidecar, refuse a checksum mismatch
#   3. refuse a target database that already holds tables in schema public
#   4. age -d with the identity file | pg_restore --no-owner --exit-on-error (the plain dump never
#      touches the disk)
#   5. remove the downloaded file
#
# Point-in-time recovery from the WAL archive is a pgBackRest restore on the database host, not
# this script; see the runbook.
#
# Usage: ops/backup/restore.sh [--help]
#
# Required environment:
#   CETELE_BACKUP_S3_ENDPOINT           S3 API endpoint (rules as in backup.sh)
#   CETELE_RESTORE_S3_READ_ACCESS_KEY   read-only identity of the backup bucket (list and get)
#   CETELE_RESTORE_S3_READ_SECRET_KEY
#   CETELE_RESTORE_AGE_IDENTITY_FILE    path of the age identity file (the private key). It is
#                                       read by age only, never copied or printed.
#   CETELE_RESTORE_PG_DATABASE          target database; it must exist and be empty
# Target, one of:
#   CETELE_RESTORE_PG_CONTAINER         container running PostgreSQL 16 (docker exec)
#   (unset)                             psql and pg_restore 16 on PATH with the libpq environment
# Optional:
#   CETELE_RESTORE_OBJECT       object key to restore instead of the newest
#   CETELE_RESTORE_PG_USER      default cetele (container mode)
#   CETELE_BACKUP_S3_BUCKET     default cetele-backups
#   CETELE_BACKUP_S3_PREFIX     default cetele/
#   CETELE_BACKUP_MC_IMAGE      as in backup.sh
#   CETELE_BACKUP_DOCKER_NETWORK
#   CETELE_BACKUP_AGE_BIN       default `age` on PATH
#
# No shell tracing; credentials are never printed. Exit codes: 0 restored, 1 a step failed,
# 2 usage or configuration error.
set -eu
set +x
umask 077

ops_name="restore"
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
  CETELE_RESTORE_AGE_IDENTITY_FILE CETELE_RESTORE_PG_DATABASE

endpoint="${CETELE_BACKUP_S3_ENDPOINT}"
network="${CETELE_BACKUP_DOCKER_NETWORK:-}"
bucket="${CETELE_BACKUP_S3_BUCKET:-cetele-backups}"
prefix="${CETELE_BACKUP_S3_PREFIX-cetele/}"
mc_image="${CETELE_BACKUP_MC_IMAGE-${CETELE_OPS_MC_IMAGE_DEFAULT}}"
age_bin="${CETELE_BACKUP_AGE_BIN:-age}"
identity="${CETELE_RESTORE_AGE_IDENTITY_FILE}"
pg_container="${CETELE_RESTORE_PG_CONTAINER:-}"
pg_database="${CETELE_RESTORE_PG_DATABASE}"
pg_user="${CETELE_RESTORE_PG_USER:-cetele}"
object="${CETELE_RESTORE_OBJECT:-}"

check_endpoint CETELE_BACKUP_S3_ENDPOINT "${endpoint}" "${network}"
check_bucket "${bucket}"
check_prefix "${prefix}"
check_url_safe CETELE_RESTORE_S3_READ_ACCESS_KEY "${CETELE_RESTORE_S3_READ_ACCESS_KEY}"
check_url_safe CETELE_RESTORE_S3_READ_SECRET_KEY "${CETELE_RESTORE_S3_READ_SECRET_KEY}"
check_identifier CETELE_RESTORE_PG_DATABASE "${pg_database}"
check_identifier CETELE_RESTORE_PG_USER "${pg_user}"
[ -f "${identity}" ] || die_config "CETELE_RESTORE_AGE_IDENTITY_FILE is not a file"
if [ -n "${object}" ]; then
  printf '%s' "${object}" | grep -Eq '^([A-Za-z0-9._-]+/)*cetele-[0-9]{8}T[0-9]{6}Z\.dump\.age$' ||
    die_config "CETELE_RESTORE_OBJECT is not a dump key (<prefix>cetele-<YYYYMMDDTHHMMSSZ>.dump.age)"
fi
require_tool "${age_bin}"
if [ -n "${pg_container}" ]; then
  check_container_name CETELE_RESTORE_PG_CONTAINER "${pg_container}"
  require_tool docker
else
  require_tool psql
  require_tool pg_restore
fi
if [ -n "${mc_image}" ]; then require_tool docker; else require_tool mc; fi

work_dir="$(mktemp -d)"
encrypted="${work_dir}/dump.age"
cleanup() {
  status=$?
  rm -f "${encrypted}" "${work_dir}/dump.sha256" "${work_dir}/listing.json" "${work_dir}/age.status" "${work_dir}/restore.status"
  rmdir "${work_dir}" 2>/dev/null || true
  exit "${status}"
}
trap cleanup EXIT
trap 'exit 1' INT TERM

mc_read() {
  mc_run r "${endpoint}" "${CETELE_RESTORE_S3_READ_ACCESS_KEY}" "${CETELE_RESTORE_S3_READ_SECRET_KEY}" "${mc_image}" "${network}" -- "$@"
}

echo "== step 1: pick the dump"
if [ -z "${object}" ]; then
  mc_read ls --json "r/${bucket}/${prefix}" >"${work_dir}/listing.json" || fail "cannot list s3://${bucket}/${prefix} with the restore identity"
  dumps="$(sed -n 's/.*"key":"\(cetele-[0-9]\{8\}T[0-9]\{6\}Z\.dump\.age\)".*/\1/p' "${work_dir}/listing.json" | sort)"
  [ -n "${dumps}" ] || fail "no dump under s3://${bucket}/${prefix}"
  count="$(printf '%s\n' "${dumps}" | wc -l | tr -d ' ')"
  object="${prefix}$(printf '%s\n' "${dumps}" | tail -n 1)"
  echo "dumps listed: ${count}, newest: ${object}"
else
  echo "requested: ${object}"
fi

echo "== step 2: download and check"
mc_read cat "r/${bucket}/${object}" >"${encrypted}" || fail "cannot download ${object} with the restore identity"
mc_read cat "r/${bucket}/${object}.sha256" >"${work_dir}/dump.sha256" || fail "cannot download ${object}.sha256"
expected="$(cut -d ' ' -f 1 <"${work_dir}/dump.sha256" | tr -d '\r\n')"
actual="$(sha256_of "${encrypted}")"
echo "downloaded: $(file_size "${encrypted}") bytes, sha256 ${actual}"
[ "${expected}" = "${actual}" ] || fail "checksum mismatch: sidecar ${expected}, file ${actual}"
echo "checksum: matches the sidecar"

echo "== step 3: check the target database ${pg_database}"
tables="$(psql_at "${pg_container}" "${pg_user}" "${pg_database}" -c "SELECT count(*) FROM pg_tables WHERE schemaname = 'public';")" ||
  fail "cannot connect to the target database ${pg_database}"
[ "${tables}" = "0" ] || fail "target database ${pg_database} already holds ${tables} tables in public; restore into a new database"
echo "target: empty"

echo "== step 4: age -d | pg_restore"
(
  set +e
  "${age_bin}" -d -i "$(native_path "${identity}")" <"${encrypted}"
  echo "$?" >"${work_dir}/age.status"
) | (
  set +e
  pg_tool "${pg_container}" "${pg_user}" "${pg_database}" pg_restore --no-owner --exit-on-error --no-password
  echo "$?" >"${work_dir}/restore.status"
)
age_status="$(read_status "${work_dir}/age.status")"
restore_status="$(read_status "${work_dir}/restore.status")"
[ "${age_status}" = "0" ] || fail "age could not decrypt ${object} (status ${age_status}; wrong identity?)"
[ "${restore_status}" = "0" ] || fail "pg_restore exited with status ${restore_status}"
tables="$(psql_at "${pg_container}" "${pg_user}" "${pg_database}" -c "SELECT count(*) FROM pg_tables WHERE schemaname = 'public';")"
echo "restored tables in public: ${tables}"

echo "RESULT: restored ${object} into ${pg_database}"
