#!/usr/bin/env bash
# Patika restore (security checklist item 20, docs/ops/backup-restore.md).
#
# Usage: restore.sh <patika-YYYYMMDDTHHMMSSZ.dump.age>
#
# Checks the .sha256 sidecar when present, decrypts with the offline age identity, confirms the file
# is a custom-format dump, creates a fresh database (it refuses an existing one), runs pg_restore
# and then the spatial smoke queries in smoke.sql. With PATIKA_RESTORE_EXPECT pointing at a file of
# expected smoke rows (for example taken from the source database), any difference fails the run.
#
# Target server: the libpq variables (PGHOST, PGPORT, PGUSER, PGPASSWORD); it must have PostGIS
# available (a postgis/postgis image). Required: PATIKA_BACKUP_AGE_IDENTITY, the identity file path.
# Optional: PATIKA_RESTORE_DB (default patika_restore), PATIKA_RESTORE_EXPECT.
set -euo pipefail

log() { printf 'restore: %s\n' "$*"; }
fail() { printf 'restore: FAIL %s\n' "$*" >&2; exit 1; }

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
input="${1:-}"
identity="${PATIKA_BACKUP_AGE_IDENTITY:-}"
database="${PATIKA_RESTORE_DB:-patika_restore}"
expect="${PATIKA_RESTORE_EXPECT:-}"

[[ -n "${input}" && -f "${input}" ]] || fail "usage: restore.sh <file.dump.age> (file not found: ${input:-none})"
[[ -n "${identity}" && -f "${identity}" ]] || fail "PATIKA_BACKUP_AGE_IDENTITY must point at the age identity file"
[[ "${database}" =~ ^[a-z_][a-z0-9_]{0,62}$ ]] || fail "PATIKA_RESTORE_DB must be a plain lower-case identifier"
for tool in age pg_restore psql createdb sha256sum; do
  command -v "${tool}" >/dev/null 2>&1 || fail "${tool} is not installed"
done

if [[ -f "${input}.sha256" ]]; then
  expected_digest="$(cut -d' ' -f1 "${input}.sha256")"
  actual_digest="$(sha256sum "${input}" | cut -d' ' -f1)"
  [[ "${expected_digest}" == "${actual_digest}" ]] || fail "checksum mismatch for $(basename "${input}")"
  log "checksum ok (${actual_digest})"
else
  log "no .sha256 sidecar next to $(basename "${input}"); checksum not checked"
fi

umask 077
work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT
plain="${work}/patika.dump"

age --decrypt --identity "${identity}" --output "${plain}" "${input}" 2>"${work}/age.err" \
  || fail "age could not decrypt $(basename "${input}"): $(head -c 200 "${work}/age.err")"
pg_restore --list "${plain}" > "${work}/toc.txt" 2>/dev/null || fail "decrypted file is not a pg_dump custom-format archive"
log "decrypted; archive lists $(wc -l < "${work}/toc.txt" | tr -d ' ') TOC lines"

exists="$(psql --dbname=postgres -v ON_ERROR_STOP=1 -tAc "SELECT 1 FROM pg_database WHERE datname = '${database}'")"
[[ -z "${exists}" ]] || fail "target database exists: ${database} (restore only into a fresh database)"
createdb --template=template0 --encoding=UTF8 "${database}"
pg_restore --no-owner --no-privileges --exit-on-error --dbname="${database}" "${plain}" \
  || fail "pg_restore into ${database} failed"
log "restored into ${database}"

psql --dbname="${database}" -v ON_ERROR_STOP=1 -X -q -tA -F'|' -f "${here}/smoke.sql" > "${work}/smoke.txt" \
  || fail "smoke queries failed on ${database}"
while IFS= read -r line; do
  log "smoke ${line}"
done < "${work}/smoke.txt"

stations="$(grep '^stations|' "${work}/smoke.txt" | cut -d'|' -f2)"
[[ "${stations:-0}" -gt 0 ]] || fail "smoke: restored database has no stations"

if [[ -n "${expect}" ]]; then
  [[ -f "${expect}" ]] || fail "PATIKA_RESTORE_EXPECT file not found: ${expect}"
  if ! diff -u "${expect}" "${work}/smoke.txt" > "${work}/smoke.diff"; then
    sed 's/^/restore:   /' "${work}/smoke.diff" >&2
    fail "smoke mismatch against ${expect}"
  fi
  log "smoke rows match $(basename "${expect}")"
fi
log "OK"
