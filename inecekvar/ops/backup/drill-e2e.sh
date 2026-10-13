#!/usr/bin/env bash
# End-to-end backup and restore drill on scratch containers (the job of
# .github/workflows/inecekvar-restore-drill.yml; also runs on a workstation with Docker, uv and
# Git Bash). Security checklist items 20 and 21, docs/ops/backup-restore.md.
#
#   1. start drill-compose.yml under a project name unique to this run: a source PostGIS
#      (published on 127.0.0.1 only) and MinIO
#   2. bucket-setup.sh: backup bucket with versioning and the 30-day rule, write-only, read-only
#      and list-only identities, media and exports bucket versioning
#   3. `alembic upgrade head`, the sample city seed and drill-seed.sql (synthetic accounts, TOTP
#      blobs encrypted at run time with a key that never leaves the generating process)
#   4. fingerprint the source with drill-stats.sql (the expected values)
#   5. create a run-only age key pair; backup.sh gets the public recipient only
#   6. backup.sh with the write-only identity
#   7. backup.verify (python -m app.workers.backup_verify) lists the bucket with the list-only
#      identity and must answer ok
#   8. negative checks: the writer cannot list, read or delete, the reader cannot write, the
#      verifier cannot read, the stored object is an age file, another identity cannot decrypt
#   9. drill-post-dump.sql: a deletion request recorded after the dump and a hard delete; the
#      requests made since the dump time are exported as the replay list
#  10. restore-drill.sh with the read-only identity, the source fingerprint and the replay list
#  11. remove the compose project (containers, network, volumes) and the key files, also on
#      failure or interrupt
#
# Every credential and the age identity are created for this run, kept in the environment or a
# 0600 temp file, and never printed.
#
# Negative runs: INECEKVAR_DRILL_MUTATION injects one fault and the drill must then fail (exit 1):
#   corrupt-dump    flip one byte of the stored dump after upload (checksum must refuse it)
#   wrong-identity  restore with another age identity (age must refuse it)
#   drop-stop       leave a published line with one stop before the fingerprint (only the
#                   two-stop rule can catch it)
#   plain-totp      store a readable base32 TOTP secret before the fingerprint
#   empty-table     delete every favorite before the fingerprint
#   skip-replay     restore without re-applying the deletion request made after the dump
#
# Usage: ops/backup/drill-e2e.sh [--help]
# Optional environment:
#   INECEKVAR_BACKUP_AGE_BIN        default `age` on PATH
#   INECEKVAR_DRILL_AGE_KEYGEN_BIN  default `age-keygen` on PATH
#   INECEKVAR_DRILL_UV_BIN          default `uv` on PATH
#   INECEKVAR_DRILL_PG_PORT         host port of the source database on 127.0.0.1, default 57791
#   INECEKVAR_DRILL_MINIO_PORT      host port of MinIO on 127.0.0.1, default 57792
#   INECEKVAR_DRILL_PG_IMAGE, INECEKVAR_DRILL_MINIO_IMAGE, INECEKVAR_BACKUP_MC_IMAGE: default
#   the images of docker-compose.yml
#   INECEKVAR_DRILL_MUTATION        see above
#
# Exit codes: 0 drill passed, 1 a step or check failed, 2 usage or configuration error.
set -euo pipefail
set +x
umask 077

ops_name="drill-e2e"
script_dir="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
# shellcheck source=lib.sh
. "${script_dir}/lib.sh"
api_dir="$(CDPATH='' cd -- "${script_dir}/../../api" && pwd)"

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

age_bin="${INECEKVAR_BACKUP_AGE_BIN:-age}"
keygen_bin="${INECEKVAR_DRILL_AGE_KEYGEN_BIN:-age-keygen}"
uv_bin="${INECEKVAR_DRILL_UV_BIN:-uv}"
pg_port="${INECEKVAR_DRILL_PG_PORT:-57791}"
minio_port="${INECEKVAR_DRILL_MINIO_PORT:-57792}"
pg_image="${INECEKVAR_DRILL_PG_IMAGE:-${INECEKVAR_OPS_PG_IMAGE_DEFAULT}}"
minio_image="${INECEKVAR_DRILL_MINIO_IMAGE:-${INECEKVAR_OPS_MINIO_IMAGE_DEFAULT}}"
mc_image="${INECEKVAR_BACKUP_MC_IMAGE:-${INECEKVAR_OPS_MC_IMAGE_DEFAULT}}"
mutation="${INECEKVAR_DRILL_MUTATION:-}"
case "${mutation}" in
  "" | corrupt-dump | wrong-identity | drop-stop | plain-totp | empty-table | skip-replay) ;;
  *) die_config "INECEKVAR_DRILL_MUTATION is not one of corrupt-dump, wrong-identity, drop-stop, plain-totp, empty-table, skip-replay" ;;
esac
for port in "${pg_port}" "${minio_port}"; do
  [[ "${port}" =~ ^[0-9]{4,5}$ ]] || die_config "drill ports must be numbers"
  # 57277-57776 holds other local stacks and ranges Windows reserves on the workstation.
  if [ "${port}" -ge 57277 ] && [ "${port}" -le 57776 ]; then
    die_config "drill port ${port} is inside 57277-57776; choose another"
  fi
done
require_tool docker
require_tool "${age_bin}"
require_tool "${keygen_bin}"
require_tool "${uv_bin}"
docker compose version >/dev/null 2>&1 || die_config "docker compose is not available"

run_id="$(date +%s)$$"
project="inecekvar-drill-${run_id}"
network="${project}_default"
work_dir="$(mktemp -d)"
compose=(docker compose -p "${project}" -f "$(native_path "${script_dir}/drill-compose.yml")")

INECEKVAR_DRILL_PG_PASSWORD="$(random_hex 16)"
INECEKVAR_DRILL_MINIO_ROOT_USER="drillroot$(random_hex 4)"
INECEKVAR_DRILL_MINIO_ROOT_PASSWORD="$(random_hex 24)"
INECEKVAR_DRILL_PG_IMAGE="${pg_image}"
INECEKVAR_DRILL_MINIO_IMAGE="${minio_image}"
INECEKVAR_DRILL_PG_PORT="${pg_port}"
INECEKVAR_DRILL_MINIO_PORT="${minio_port}"
export INECEKVAR_DRILL_PG_PASSWORD INECEKVAR_DRILL_MINIO_ROOT_USER INECEKVAR_DRILL_MINIO_ROOT_PASSWORD \
  INECEKVAR_DRILL_PG_IMAGE INECEKVAR_DRILL_MINIO_IMAGE INECEKVAR_DRILL_PG_PORT INECEKVAR_DRILL_MINIO_PORT

cleanup() {
  local status=$?
  "${compose[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  rm -f "${work_dir}"/*
  rmdir "${work_dir}" 2>/dev/null || true
  echo "cleanup: removed compose project ${project} (containers, network, volumes) and the run keys"
  exit "${status}"
}
trap cleanup EXIT
trap 'exit 1' INT TERM

echo "images: ${pg_image}, ${minio_image}, ${mc_image}"
echo "age: $("${age_bin}" --version)"
[ -z "${mutation}" ] || echo "mutation: ${mutation} (this run must fail)"

echo "== step 1: compose project ${project}"
"${compose[@]}" up -d --wait --quiet-pull >"${work_dir}/compose.log" 2>&1 || {
  tail -n 20 "${work_dir}/compose.log" >&2
  fail "the drill stack did not become healthy"
}
source_db="$("${compose[@]}" ps -q source)"
[ -n "${source_db}" ] || fail "no source container"
echo "ready: source PostgreSQL $(psql_at "${source_db}" inecekvar inecekvar -c 'SHOW server_version;') with PostGIS $(psql_at "${source_db}" inecekvar inecekvar -c 'SELECT extversion FROM pg_extension WHERE extname = '"'"'postgis'"'"';'), MinIO; host ports 127.0.0.1:${pg_port} and 127.0.0.1:${minio_port}"

INECEKVAR_BACKUP_S3_ENDPOINT="http://minio:9000"
INECEKVAR_BACKUP_DOCKER_NETWORK="${network}"
INECEKVAR_BACKUP_MC_IMAGE="${mc_image}"
INECEKVAR_BACKUP_AGE_BIN="${age_bin}"
INECEKVAR_BACKUP_S3_WRITE_ACCESS_KEY="drillwriter$(random_hex 4)"
INECEKVAR_BACKUP_S3_WRITE_SECRET_KEY="$(random_hex 24)"
INECEKVAR_RESTORE_S3_READ_ACCESS_KEY="drillreader$(random_hex 4)"
INECEKVAR_RESTORE_S3_READ_SECRET_KEY="$(random_hex 24)"
INECEKVAR_BACKUP_VERIFY_ACCESS_KEY_ID="drillverifier$(random_hex 4)"
INECEKVAR_BACKUP_VERIFY_SECRET_ACCESS_KEY="$(random_hex 24)"
export INECEKVAR_BACKUP_S3_ENDPOINT INECEKVAR_BACKUP_DOCKER_NETWORK INECEKVAR_BACKUP_MC_IMAGE INECEKVAR_BACKUP_AGE_BIN \
  INECEKVAR_BACKUP_S3_WRITE_ACCESS_KEY INECEKVAR_BACKUP_S3_WRITE_SECRET_KEY \
  INECEKVAR_RESTORE_S3_READ_ACCESS_KEY INECEKVAR_RESTORE_S3_READ_SECRET_KEY \
  INECEKVAR_BACKUP_VERIFY_ACCESS_KEY_ID INECEKVAR_BACKUP_VERIFY_SECRET_ACCESS_KEY
bucket="${INECEKVAR_BACKUP_S3_BUCKET:-${INECEKVAR_OPS_BUCKET_DEFAULT}}"
prefix="${INECEKVAR_BACKUP_S3_PREFIX-${INECEKVAR_OPS_PREFIX_DEFAULT}}"

echo "== step 2: buckets and identities"
INECEKVAR_BACKUP_S3_ADMIN_ACCESS_KEY="${INECEKVAR_DRILL_MINIO_ROOT_USER}" \
  INECEKVAR_BACKUP_S3_ADMIN_SECRET_KEY="${INECEKVAR_DRILL_MINIO_ROOT_PASSWORD}" \
  bash "${script_dir}/bucket-setup.sh" || fail "bucket-setup.sh failed"

echo "== step 3: migrations, sample city and synthetic accounts"
database_url="postgresql+asyncpg://inecekvar:${INECEKVAR_DRILL_PG_PASSWORD}@127.0.0.1:${pg_port}/inecekvar"
(cd "${api_dir}" && INECEKVAR_DATABASE_URL="${database_url}" "${uv_bin}" run --quiet alembic upgrade head) \
  >"${work_dir}/alembic.log" 2>&1 || {
  tail -n 20 "${work_dir}/alembic.log" >&2
  fail "alembic upgrade head failed"
}
echo "migrated: alembic head $(psql_at "${source_db}" inecekvar inecekvar -c 'SELECT version_num FROM alembic_version;')"
(cd "${api_dir}" && INECEKVAR_ENV=local INECEKVAR_DATABASE_URL="${database_url}" "${uv_bin}" run --quiet python -m app.seed) ||
  fail "sample city seed failed"
# Two TOTP blobs from the application's own encryption with a key created and dropped inside
# this one process.
(cd "${api_dir}" && "${uv_bin}" run --quiet python -c '
import secrets, uuid
from app.auth.totp import encrypt_secret, new_secret
key = secrets.token_bytes(32)
for suffix in ("d001", "d002"):
    print(encrypt_secret(key, uuid.UUID("01990000-0000-7000-8000-00000000" + suffix), new_secret()).hex())
') >"${work_dir}/totp.txt" || fail "TOTP blob generation failed"
psql_at "${source_db}" inecekvar inecekvar -v "totp_a=$(sed -n 1p "${work_dir}/totp.txt")" \
  -v "totp_b=$(sed -n 2p "${work_dir}/totp.txt")" <"${script_dir}/drill-seed.sql" >/dev/null || fail "drill-seed.sql failed"
echo "seeded: sample city and drill-seed.sql"

case "${mutation}" in
  drop-stop)
    psql_at "${source_db}" inecekvar inecekvar >/dev/null <<'SQL' || fail "mutation drop-stop failed"
SET session_replication_role = replica;
DELETE FROM public.line_stops ls
USING public.lines l
WHERE l.slug = 'ornek-hat-3' AND ls.line_version_id = l.current_version_id
  AND ls.seq > (SELECT min(seq) FROM public.line_stops WHERE line_version_id = l.current_version_id);
SQL
    echo "mutation: published line ornek-hat-3 left with one stop (immutability trigger bypassed)"
    ;;
  plain-totp)
    psql_at "${source_db}" inecekvar inecekvar >/dev/null <<'SQL' || fail "mutation plain-totp failed"
UPDATE public.users
SET totp_secret_enc = convert_to((SELECT string_agg(substr('ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', 1 + floor(random() * 32)::int, 1), '')
                                  FROM generate_series(1, 32)), 'UTF8')
WHERE id = '01990000-0000-7000-8000-00000000d001';
SQL
    echo "mutation: a readable base32 TOTP secret stored for d001"
    ;;
  empty-table)
    psql_at "${source_db}" inecekvar inecekvar -c 'DELETE FROM public.favorites;' >/dev/null || fail "mutation empty-table failed"
    echo "mutation: every favorite deleted"
    ;;
esac

echo "== step 4: source fingerprint"
psql_at "${source_db}" inecekvar inecekvar <"${script_dir}/drill-stats.sql" | tr -d '\r' >"${work_dir}/expected.txt"
cat "${work_dir}/expected.txt"

echo "== step 5: run-only age key pair"
"${keygen_bin}" -o "$(native_path "${work_dir}/identity.txt")" 2>/dev/null
"${keygen_bin}" -o "$(native_path "${work_dir}/other-identity.txt")" 2>/dev/null
INECEKVAR_BACKUP_AGE_RECIPIENT="$("${keygen_bin}" -y "$(native_path "${work_dir}/identity.txt")" | tr -d '\r')"
export INECEKVAR_BACKUP_AGE_RECIPIENT
echo "recipient: public key of a run-only identity (the identity stays in a 0600 temp file)"

echo "== step 6: backup.sh"
INECEKVAR_BACKUP_PG_CONTAINER="${source_db}" bash "${script_dir}/backup.sh" || fail "backup.sh failed"

mc_as() {
  local role="$1" access secret
  shift
  case "${role}" in
    w) access="${INECEKVAR_BACKUP_S3_WRITE_ACCESS_KEY}" secret="${INECEKVAR_BACKUP_S3_WRITE_SECRET_KEY}" ;;
    r) access="${INECEKVAR_RESTORE_S3_READ_ACCESS_KEY}" secret="${INECEKVAR_RESTORE_S3_READ_SECRET_KEY}" ;;
    v) access="${INECEKVAR_BACKUP_VERIFY_ACCESS_KEY_ID}" secret="${INECEKVAR_BACKUP_VERIFY_SECRET_ACCESS_KEY}" ;;
    a) access="${INECEKVAR_DRILL_MINIO_ROOT_USER}" secret="${INECEKVAR_DRILL_MINIO_ROOT_PASSWORD}" ;;
  esac
  mc_run "${role}" "${INECEKVAR_BACKUP_S3_ENDPOINT}" "${access}" "${secret}" "${mc_image}" "${network}" -- "$@"
}
mc_as r ls --json "r/${bucket}/${prefix}" >"${work_dir}/listing.json" || fail "the reader cannot list"
object="${prefix}$(newest_dump_key "${work_dir}/listing.json")"
dump_time="$(dump_stamp_iso "${object}")" || fail "no dump in the bucket listing"
echo "stored: ${object} (dump time ${dump_time})"

echo "== step 7: backup.verify with the list-only identity"
(cd "${api_dir}" && env INECEKVAR_BACKUP_VERIFY_ENDPOINT_URL="http://127.0.0.1:${minio_port}" \
  INECEKVAR_BACKUP_VERIFY_REGION=us-east-1 INECEKVAR_BACKUP_VERIFY_BUCKET="${bucket}" \
  INECEKVAR_BACKUP_VERIFY_PREFIX="${prefix}" "${uv_bin}" run --quiet python -m app.workers.backup_verify) \
  >"${work_dir}/verify.json" 2>"${work_dir}/verify.log" || {
  cat "${work_dir}/verify.json" "${work_dir}/verify.log" >&2
  fail "backup.verify did not answer ok"
}
grep -o '"status": "[a-z_]*"\|"age_seconds": [0-9]*\|"size_bytes": [0-9]*\|"dumps": [0-9]*' "${work_dir}/verify.json" | tr '\n' ' '
echo
if grep -q "${INECEKVAR_BACKUP_VERIFY_SECRET_ACCESS_KEY}" "${work_dir}/verify.json" "${work_dir}/verify.log"; then
  fail "backup.verify printed its secret"
fi
echo "backup.verify: ok, no credential in its output"

echo "== step 8: negative checks"
if mc_as w ls "w/${bucket}/${prefix}" >/dev/null 2>&1; then fail "the write-only identity could list the bucket"; fi
echo "writer list: denied (expected)"
if mc_as w cat "w/${bucket}/${object}" >/dev/null 2>&1; then fail "the write-only identity could read a dump"; fi
echo "writer read: denied (expected)"
if mc_as w rm "w/${bucket}/${object}" >/dev/null 2>&1; then fail "the write-only identity could delete a dump"; fi
echo "writer delete: denied (expected)"
if echo probe | mc_as r pipe "r/${bucket}/${prefix}probe.txt" >/dev/null 2>&1; then fail "the read-only identity could write"; fi
echo "reader write: denied (expected)"
if mc_as v cat "v/${bucket}/${object}" >/dev/null 2>&1; then fail "the list-only identity could read a dump"; fi
echo "verifier read: denied (expected)"
mc_as r cat "r/${bucket}/${object}" >"${work_dir}/object.age" || fail "the reader cannot download ${object}"
[ "$(head -c 21 "${work_dir}/object.age")" = "age-encryption.org/v1" ] || fail "the stored object is not an age file"
if grep -a -q 'drill.invalid' "${work_dir}/object.age"; then fail "seeded plain text found in the stored object"; fi
echo "stored object: age file, no seeded plain text in $(file_size "${work_dir}/object.age") bytes"
if "${age_bin}" -d -i "$(native_path "${work_dir}/other-identity.txt")" <"${work_dir}/object.age" >/dev/null 2>&1; then
  fail "another identity could decrypt the dump"
fi
echo "decrypt with another identity: refused (expected)"

echo "== step 9: changes after the dump"
psql_at "${source_db}" inecekvar inecekvar <"${script_dir}/drill-post-dump.sql" >/dev/null || fail "drill-post-dump.sql failed"
psql_at "${source_db}" inecekvar inecekvar -v "since=${dump_time}" >"${work_dir}/deletions.txt" <<'SQL' || fail "cannot export the replay list"
SELECT user_id || ' ' || to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
FROM public.deletion_requests
WHERE created_at >= :'since'::timestamptz
ORDER BY created_at;
SQL
tr -d '\r' <"${work_dir}/deletions.txt" >"${work_dir}/deletions.lf"
mv "${work_dir}/deletions.lf" "${work_dir}/deletions.txt"
grep -q '^01990000-0000-7000-8000-00000000d005 ' "${work_dir}/deletions.txt" ||
  fail "the replay list misses the request recorded after the dump"
echo "after the dump: d005 asked for deletion, d004 hard-deleted; replay list $(grep -c . "${work_dir}/deletions.txt") request(s) since ${dump_time}"

if [ "${mutation}" = "corrupt-dump" ]; then
  mc_as a cat "a/${bucket}/${object}" >"${work_dir}/corrupt.age" || fail "mutation corrupt-dump: download failed"
  offset=$(($(file_size "${work_dir}/corrupt.age") / 2))
  byte="$(od -An -tu1 -j "${offset}" -N1 "${work_dir}/corrupt.age" | tr -d ' ')"
  # shellcheck disable=SC2059 # the format is the octal escape of one computed byte
  printf "\\$(printf '%03o' $((byte ^ 1)))" | dd of="${work_dir}/corrupt.age" bs=1 seek="${offset}" conv=notrunc 2>/dev/null
  mc_as a pipe "a/${bucket}/${object}" <"${work_dir}/corrupt.age" >/dev/null || fail "mutation corrupt-dump: upload failed"
  echo "mutation: byte ${offset} of the stored dump flipped (sidecar unchanged)"
fi

echo "== step 10: restore-drill.sh"
identity="${work_dir}/identity.txt"
replay=1
if [ "${mutation}" = "wrong-identity" ]; then
  identity="${work_dir}/other-identity.txt"
  echo "mutation: restoring with another age identity"
fi
if [ "${mutation}" = "skip-replay" ]; then
  replay=0
  echo "mutation: the deletion replay only flags"
fi
INECEKVAR_RESTORE_AGE_IDENTITY_FILE="${identity}" INECEKVAR_DRILL_EXPECTED="${work_dir}/expected.txt" \
  INECEKVAR_DRILL_DELETIONS="${work_dir}/deletions.txt" INECEKVAR_DRILL_REPLAY="${replay}" \
  INECEKVAR_DRILL_PG_IMAGE="${pg_image}" \
  INECEKVAR_DRILL_REQUIRED_TABLES="alembic_version cities stops lines line_versions line_stops users favorites traces edits deletion_requests audit_logs sessions refresh_tokens" \
  bash "${script_dir}/restore-drill.sh" || fail "restore-drill.sh failed"

echo "RESULT: end-to-end drill passed"
