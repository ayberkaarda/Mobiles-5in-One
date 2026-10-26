#!/usr/bin/env bash
# Patika database backup (security checklist item 20, docs/ops/backup-restore.md).
#
# pg_dump -Fc piped straight into age, so the plaintext dump never touches disk. The encrypted file
# and its .sha256 sidecar land in PATIKA_BACKUP_DIR; when PATIKA_BACKUP_S3_URI is set they are also
# copied to an S3-compatible bucket (R2, MinIO) with `aws s3 cp`. Local copies older than
# PATIKA_BACKUP_RETENTION_DAYS are pruned; the bucket keeps its own 30-day lifecycle rule because the
# upload credential is write-only and cannot delete.
#
# Connection: the libpq variables (PGHOST, PGPORT, PGUSER, PGDATABASE, PGSERVICE) or
# PATIKA_BACKUP_DATABASE_URL (a postgresql:// URI). The password never reaches a command line: a password in
# the URL or in PGPASSWORD is moved into a private temporary PGPASSFILE (pgpass.sh) that the EXIT trap removes,
# and PGPASSWORD is unset before pg_dump starts. Required: PATIKA_BACKUP_AGE_RECIPIENT, the age public key
# (age1...). The private identity stays offline and is only needed by restore.sh.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=pgpass.sh
. "${here}/pgpass.sh"

log() { printf 'backup: %s\n' "$*"; }
fail() { printf 'backup: FAIL %s\n' "$*" >&2; exit 1; }

recipient="${PATIKA_BACKUP_AGE_RECIPIENT:-}"
out_dir="${PATIKA_BACKUP_DIR:-./backups}"
retention_days="${PATIKA_BACKUP_RETENTION_DAYS:-30}"
s3_uri="${PATIKA_BACKUP_S3_URI:-}"
s3_endpoint="${PATIKA_BACKUP_S3_ENDPOINT:-}"
database_url="${PATIKA_BACKUP_DATABASE_URL:-}"
# The URL may carry the password: keep it in this shell only, never in a child's environment.
unset PATIKA_BACKUP_DATABASE_URL

[[ "${recipient}" == age1* ]] || fail "PATIKA_BACKUP_AGE_RECIPIENT must be an age public key (age1...)"
[[ "${retention_days}" =~ ^[0-9]+$ ]] || fail "PATIKA_BACKUP_RETENTION_DAYS must be a whole number of days"
for tool in pg_dump age sha256sum; do
  command -v "${tool}" >/dev/null 2>&1 || fail "${tool} is not installed"
done
if [[ -n "${s3_uri}" ]]; then
  command -v aws >/dev/null 2>&1 || fail "PATIKA_BACKUP_S3_URI is set but the aws CLI is not installed"
fi

umask 077
mkdir -p "${out_dir}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
name="patika-${stamp}.dump.age"
partial="${out_dir}/.${name}.partial"
secrets="$(mktemp -d)"
trap 'rm -f "${partial}"; rm -rf "${secrets}"' EXIT

# Only non-secret connection parameters end up in the environment; the password goes to ${secrets}/pgpass.
pgpass_setup "${database_url}" "${secrets}" \
  || fail "PATIKA_BACKUP_DATABASE_URL is not a postgresql:// URI this script reads (only the sslmode parameter is supported)"
dump_args=(--format=custom --compress=6)

# pipefail makes a pg_dump failure fail the pipeline even though age exits 0 on a short input.
pg_dump "${dump_args[@]}" | age --encrypt --recipient "${recipient}" --output "${partial}" \
  || fail "pg_dump or age failed; no backup written"

[[ -s "${partial}" ]] || fail "encrypted dump is empty"
mv "${partial}" "${out_dir}/${name}"
(cd "${out_dir}" && sha256sum "${name}" > "${name}.sha256")
size="$(wc -c < "${out_dir}/${name}" | tr -d ' ')"
digest="$(cut -d' ' -f1 "${out_dir}/${name}.sha256")"
log "wrote ${name} (${size} bytes, sha256 ${digest})"

if [[ -n "${s3_uri}" ]]; then
  aws_args=()
  if [[ -n "${s3_endpoint}" ]]; then
    aws_args+=(--endpoint-url "${s3_endpoint}")
  fi
  aws "${aws_args[@]}" s3 cp --only-show-errors "${out_dir}/${name}" "${s3_uri%/}/${name}" \
    || fail "upload of ${name} failed"
  aws "${aws_args[@]}" s3 cp --only-show-errors "${out_dir}/${name}.sha256" "${s3_uri%/}/${name}.sha256" \
    || fail "upload of ${name}.sha256 failed"
  log "uploaded ${name} to ${s3_uri%/}/"
else
  log "no PATIKA_BACKUP_S3_URI; kept the local copy only"
fi

pruned=0
while IFS= read -r old; do
  rm -f -- "${old}"
  pruned=$((pruned + 1))
done < <(find "${out_dir}" -maxdepth 1 -type f \( -name 'patika-*.dump.age' -o -name 'patika-*.dump.age.sha256' \) \
  -mtime +"${retention_days}" -print)
log "pruned ${pruned} local files older than ${retention_days} days"
