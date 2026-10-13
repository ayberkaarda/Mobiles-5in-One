#!/usr/bin/env bash
# Daily logical backup of the Inecek Var database (security checklist item 20,
# docs/ops/backup-restore.md).
#
#   1. pg_dump -Fc of the application database, piped straight into `age` with the public
#      recipient, so the plain dump never touches the disk
#   2. check the result is an age file, record its size and SHA-256
#   3. upload <prefix>inecekvar-<UTC timestamp>.dump.age and a .sha256 sidecar to the backup
#      bucket with the write-only identity (PutObject only: it can neither list, read nor delete)
#   4. remove the local encrypted file
#
# There is no WAL archive: the recovery point is the last dump (up to 24 hours). Retention
# (30 days) is a lifecycle rule on the bucket (backup-lifecycle.json), never a delete here.
#
# Usage: ops/backup/backup.sh [--help]
#
# Required environment:
#   INECEKVAR_BACKUP_AGE_RECIPIENT         age public key (age1...). Never the private identity:
#                                          a value holding AGE-SECRET-KEY is refused.
#   INECEKVAR_BACKUP_S3_ENDPOINT           S3 API endpoint (https; http only for local addresses
#                                          or a name on INECEKVAR_BACKUP_DOCKER_NETWORK)
#   INECEKVAR_BACKUP_S3_WRITE_ACCESS_KEY   write-only identity of the backup bucket
#   INECEKVAR_BACKUP_S3_WRITE_SECRET_KEY
# Database source, one of:
#   INECEKVAR_BACKUP_PG_CONTAINER          container running PostgreSQL 16 with PostGIS (docker
#                                          exec, local socket), for example inecekvar-postgres-1
#   (unset)                                pg_dump 16 on PATH with the libpq environment (PGHOST,
#                                          PGPORT, PGUSER, PGPASSFILE or PGPASSWORD)
# Optional:
#   INECEKVAR_BACKUP_PG_DATABASE   default inecekvar
#   INECEKVAR_BACKUP_PG_USER       default inecekvar (container mode)
#   INECEKVAR_BACKUP_S3_BUCKET     default inecekvar-backups
#   INECEKVAR_BACKUP_S3_PREFIX     default inecekvar/
#   INECEKVAR_BACKUP_MC_IMAGE      bucket client image, default the minio-init image of
#                                  docker-compose.yml; empty uses `mc` on PATH
#   INECEKVAR_BACKUP_DOCKER_NETWORK  docker network for the bucket client container
#   INECEKVAR_BACKUP_AGE_BIN       age binary, default `age` on PATH
#
# No shell tracing; credentials are never printed. Exit codes: 0 uploaded, 1 a step failed,
# 2 usage or configuration error.
set -euo pipefail
set +x
umask 077

ops_name="backup"
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

require_env INECEKVAR_BACKUP_AGE_RECIPIENT INECEKVAR_BACKUP_S3_ENDPOINT \
  INECEKVAR_BACKUP_S3_WRITE_ACCESS_KEY INECEKVAR_BACKUP_S3_WRITE_SECRET_KEY

recipient="${INECEKVAR_BACKUP_AGE_RECIPIENT}"
case "${recipient}" in
  *AGE-SECRET-KEY* | *age-secret-key*) die_config "INECEKVAR_BACKUP_AGE_RECIPIENT holds a private identity; give the public recipient (age1...) only" ;;
esac
[[ "${recipient}" =~ ^age1[02-9ac-hj-np-z]{58}$ ]] || die_config "INECEKVAR_BACKUP_AGE_RECIPIENT is not an age X25519 recipient (age1...)"

endpoint="${INECEKVAR_BACKUP_S3_ENDPOINT}"
network="${INECEKVAR_BACKUP_DOCKER_NETWORK:-}"
bucket="${INECEKVAR_BACKUP_S3_BUCKET:-${INECEKVAR_OPS_BUCKET_DEFAULT}}"
prefix="${INECEKVAR_BACKUP_S3_PREFIX-${INECEKVAR_OPS_PREFIX_DEFAULT}}"
mc_image="${INECEKVAR_BACKUP_MC_IMAGE-${INECEKVAR_OPS_MC_IMAGE_DEFAULT}}"
age_bin="${INECEKVAR_BACKUP_AGE_BIN:-age}"
pg_container="${INECEKVAR_BACKUP_PG_CONTAINER:-}"
pg_database="${INECEKVAR_BACKUP_PG_DATABASE:-inecekvar}"
pg_user="${INECEKVAR_BACKUP_PG_USER:-inecekvar}"

check_endpoint INECEKVAR_BACKUP_S3_ENDPOINT "${endpoint}" "${network}"
check_bucket "${bucket}"
check_prefix "${prefix}"
check_url_safe INECEKVAR_BACKUP_S3_WRITE_ACCESS_KEY "${INECEKVAR_BACKUP_S3_WRITE_ACCESS_KEY}"
check_url_safe INECEKVAR_BACKUP_S3_WRITE_SECRET_KEY "${INECEKVAR_BACKUP_S3_WRITE_SECRET_KEY}"
check_identifier INECEKVAR_BACKUP_PG_DATABASE "${pg_database}"
check_identifier INECEKVAR_BACKUP_PG_USER "${pg_user}"
require_tool "${age_bin}"
if [ -n "${pg_container}" ]; then
  check_container_name INECEKVAR_BACKUP_PG_CONTAINER "${pg_container}"
  require_tool docker
else
  require_tool pg_dump
fi
if [ -n "${mc_image}" ]; then require_tool docker; else require_tool mc; fi

work_dir="$(mktemp -d)"
encrypted="${work_dir}/dump.age"
cleanup() {
  local status=$?
  rm -f "${encrypted}" "${work_dir}/dump.sha256"
  rmdir "${work_dir}" 2>/dev/null || true
  exit "${status}"
}
trap cleanup EXIT
trap 'exit 1' INT TERM

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
object="${prefix}inecekvar-${stamp}.dump.age"

echo "== step 1: pg_dump -Fc | age (database ${pg_database})"
set +e
pg_tool "${pg_container}" "${pg_user}" "${pg_database}" pg_dump -Fc --no-password |
  "${age_bin}" -r "${recipient}" >"${encrypted}"
statuses=("${PIPESTATUS[@]}")
set -e
[ "${statuses[0]}" = "0" ] || fail "pg_dump exited with status ${statuses[0]}"
[ "${statuses[1]}" = "0" ] || fail "age exited with status ${statuses[1]}"

echo "== step 2: check the encrypted file"
header="$(head -c 21 "${encrypted}")"
[ "${header}" = "age-encryption.org/v1" ] || fail "the output is not an age file"
size="$(file_size "${encrypted}")"
digest="$(sha256_of "${encrypted}")"
echo "encrypted dump: ${size} bytes, sha256 ${digest}"
printf '%s  %s\n' "${digest}" "${object##*/}" >"${work_dir}/dump.sha256"

echo "== step 3: upload with the write-only identity"
mc_write() {
  mc_run w "${endpoint}" "${INECEKVAR_BACKUP_S3_WRITE_ACCESS_KEY}" "${INECEKVAR_BACKUP_S3_WRITE_SECRET_KEY}" \
    "${mc_image}" "${network}" -- "$@"
}
mc_write pipe "w/${bucket}/${object}" <"${encrypted}" >/dev/null || fail "upload of the encrypted dump failed"
mc_write pipe "w/${bucket}/${object}.sha256" <"${work_dir}/dump.sha256" >/dev/null || fail "upload of the checksum file failed"
echo "uploaded: s3://${bucket}/${object} and ${object##*/}.sha256"

echo "RESULT: backup uploaded ${object}"
