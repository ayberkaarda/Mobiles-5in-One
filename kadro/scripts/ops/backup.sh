#!/usr/bin/env bash
# Daily database backup (security checklist item 20, ADR-0002, ADR-0082).
#
#   1. pg_dump --format=custom of DATABASE_URL
#   2. encrypt the dump with `age` to the public recipient in BACKUP_AGE_RECIPIENT
#   3. upload the encrypted file to the S3-compatible bucket (Cloudflare R2) as
#      <BACKUP_PREFIX>YYYYMMDD.dump.age, the key pattern `backup.verify` checks
#
# Usage: scripts/ops/backup.sh [--dry-run] [--out FILE] [--help]
#
#   --dry-run   run steps 1 and 2 and print the key that would be written; no upload, and the
#               upload variables are not required
#   --out FILE  keep the encrypted dump at FILE (default: a private temporary file that is
#               removed on exit)
#
# Required environment:
#   DATABASE_URL                     PostgreSQL connection URI of the database to dump. Prefer a URI
#                                    without a password plus ~/.pgpass (mode 0600): a password in
#                                    the URI is visible in the process list while pg_dump runs.
#   BACKUP_AGE_RECIPIENT             age public key (age1...). The identity never lives on the host.
# Required unless --dry-run:
#   R2_ENDPOINT                      S3 API endpoint, https://<account>.r2.cloudflarestorage.com
#   BACKUP_UPLOAD_ACCESS_KEY_ID      write-only key pair for the backup bucket (not the read-only
#   BACKUP_UPLOAD_SECRET_ACCESS_KEY  pair `backup.verify` uses)
# Optional:
#   BACKUP_BUCKET   default kadro-backups
#   BACKUP_PREFIX   default kadro- (must match the worker's BACKUP_PREFIX)
#   BACKUP_DATE     YYYYMMDD, default today in UTC
#
# The script never prints the connection string, credentials or dump contents, and never runs with
# shell tracing. Exit codes: 0 success, 1 a step failed, 2 usage or configuration error.
set -euo pipefail
set +x
umask 077

usage() {
  sed -n '2,/^set -euo pipefail$/p' "$0" | sed -e '$d' -e 's/^# \{0,1\}//'
}

die_config() {
  echo "backup: $*" >&2
  exit 2
}

DRY_RUN=0
OUT_FILE=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --out)
      [ "$#" -ge 2 ] && [ -n "$2" ] || die_config "--out needs a file path"
      OUT_FILE="$2"
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *) die_config "unknown argument: $1 (see --help)" ;;
  esac
  shift
done

BUCKET="${BACKUP_BUCKET:-kadro-backups}"
PREFIX="${BACKUP_PREFIX:-kadro-}"
DATE="${BACKUP_DATE:-$(date -u +%Y%m%d)}"

# Collect every missing name first so one run reports all of them. Only names are printed.
missing=()
for name in DATABASE_URL BACKUP_AGE_RECIPIENT; do
  [ -n "${!name:-}" ] || missing+=("${name}")
done
if [ "${DRY_RUN}" -eq 0 ]; then
  for name in R2_ENDPOINT BACKUP_UPLOAD_ACCESS_KEY_ID BACKUP_UPLOAD_SECRET_ACCESS_KEY; do
    [ -n "${!name:-}" ] || missing+=("${name}")
  done
fi
if [ "${#missing[@]}" -gt 0 ]; then
  die_config "refusing to run, missing environment: ${missing[*]}"
fi

case "${DATABASE_URL}" in
  postgres://* | postgresql://*) ;;
  *) die_config "DATABASE_URL must be a postgres:// or postgresql:// URI" ;;
esac
# age X25519 recipients are lower-case bech32 strings starting with age1.
if ! [[ "${BACKUP_AGE_RECIPIENT}" =~ ^age1[02-9ac-hj-np-z]{58}$ ]]; then
  die_config "BACKUP_AGE_RECIPIENT is not an age public key (age1...)"
fi
if ! [[ "${BUCKET}" =~ ^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$ ]]; then
  die_config "BACKUP_BUCKET is not a valid bucket name"
fi
if ! [[ "${PREFIX}" =~ ^[A-Za-z0-9._/-]{0,64}$ ]]; then
  die_config "BACKUP_PREFIX may only contain letters, digits, '.', '_', '/' and '-'"
fi
if ! [[ "${DATE}" =~ ^[0-9]{8}$ ]]; then
  die_config "BACKUP_DATE must be YYYYMMDD"
fi
if [ "${DRY_RUN}" -eq 0 ]; then
  case "${R2_ENDPOINT}" in
    https://* | http://localhost* | http://127.0.0.1*) ;;
    *) die_config "R2_ENDPOINT must use https (http only for localhost)" ;;
  esac
fi

required_tools=(pg_dump age)
[ "${DRY_RUN}" -eq 1 ] || required_tools+=(aws)
for tool in "${required_tools[@]}"; do
  command -v "${tool}" >/dev/null 2>&1 || die_config "required tool not found on PATH: ${tool}"
done

KEY="${PREFIX}${DATE}.dump.age"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/kadro-backup.XXXXXX")"
cleanup() {
  status=$?
  rm -f "${WORK_DIR}/backup.dump.age"
  # A failed run must not leave a partial file that looks like a backup.
  if [ "${status}" -ne 0 ] && [ -n "${OUT_FILE}" ] && [ "${CREATED_OUT:-0}" -eq 1 ]; then
    rm -f "${OUT_FILE}"
  fi
  rmdir "${WORK_DIR}" 2>/dev/null || true
  exit "${status}"
}
trap cleanup EXIT INT TERM

TARGET="${OUT_FILE:-${WORK_DIR}/backup.dump.age}"
if [ -n "${OUT_FILE}" ]; then
  [ ! -e "${OUT_FILE}" ] || die_config "--out file already exists: ${OUT_FILE}"
  CREATED_OUT=1
fi

echo "backup: key ${KEY} (bucket ${BUCKET})"
echo "backup: dumping and encrypting"
# The plaintext dump only exists in the pipe, never on disk. pipefail makes a pg_dump failure fail
# the script even though age exits 0 on a truncated stream.
pg_dump --format=custom --no-password --dbname="${DATABASE_URL}" |
  age --encrypt --recipient "${BACKUP_AGE_RECIPIENT}" --output "${TARGET}"

SIZE="$(wc -c <"${TARGET}" | tr -d ' ')"
HEADER="$(head -c 21 "${TARGET}")"
if [ "${HEADER}" != "age-encryption.org/v1" ]; then
  echo "backup: FAIL encrypted file does not start with the age header" >&2
  exit 1
fi
echo "backup: encrypted dump ${SIZE} bytes, age header present"

if [ "${DRY_RUN}" -eq 1 ]; then
  echo "backup: dry run, skipped upload to s3://${BUCKET}/${KEY}"
  [ -z "${OUT_FILE}" ] || echo "backup: kept encrypted dump at ${OUT_FILE}"
  echo "RESULT: backup dry run passed"
  exit 0
fi

echo "backup: uploading to s3://${BUCKET}/${KEY}"
AWS_ACCESS_KEY_ID="${BACKUP_UPLOAD_ACCESS_KEY_ID}" \
  AWS_SECRET_ACCESS_KEY="${BACKUP_UPLOAD_SECRET_ACCESS_KEY}" \
  AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-auto}" \
  aws s3 cp "${TARGET}" "s3://${BUCKET}/${KEY}" \
  --endpoint-url "${R2_ENDPOINT}" \
  --content-type application/octet-stream \
  --only-show-errors --no-progress
echo "RESULT: backup uploaded (${SIZE} bytes)"
