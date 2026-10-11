#!/bin/sh
# End-to-end backup and restore drill on scratch containers (the job of
# .github/workflows/cetele-restore-drill.yml; also runs on a workstation with Docker and Git Bash).
#
#   1. start a private docker network, MinIO and a source PostgreSQL 16 (no published ports)
#   2. bucket-setup.sh: backup bucket with the 30-day rule, write-only and read-only
#      identities, media bucket versioning
#   3. apply the server migrations V1..Vn in version order with psql, then drill-seed.sql
#   4. fingerprint the source with drill-stats.sql (the expected values)
#   5. create a run-only age key pair; backup.sh gets the public recipient only
#   6. backup.sh with the write-only identity
#   7. negative checks: the writer cannot list or read, the reader cannot write, the stored object
#      holds no seeded plain text, and another age identity cannot decrypt it
#   8. restore-drill.sh with the read-only identity and the source fingerprint
#   9. remove every container, the network and the key files (also on failure or interrupt)
#
# Every credential and the age identity are created for this run, kept in the environment or a
# 0600 temp file, and never printed. Only containers and the network named by this run are
# removed, by exact name.
#
# Usage: ops/backup/drill-e2e.sh [--help]
# Optional environment:
#   CETELE_BACKUP_AGE_BIN       default `age` on PATH
#   CETELE_DRILL_AGE_KEYGEN_BIN default `age-keygen` on PATH
#   CETELE_DRILL_PG_IMAGE, CETELE_BACKUP_MC_IMAGE, CETELE_DRILL_MINIO_IMAGE: default the images
#   of docker-compose.yml
#
# Exit codes: 0 drill passed, 1 a step or check failed, 2 usage or configuration error.
set -eu
set +x
umask 077

ops_name="drill-e2e"
script_dir="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
# shellcheck source=lib.sh
. "${script_dir}/lib.sh"
migrations_dir="${script_dir}/../../server/src/main/resources/db/migration"

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

age_bin="${CETELE_BACKUP_AGE_BIN:-age}"
keygen_bin="${CETELE_DRILL_AGE_KEYGEN_BIN:-age-keygen}"
pg_image="${CETELE_DRILL_PG_IMAGE:-${CETELE_OPS_PG_IMAGE_DEFAULT}}"
mc_image="${CETELE_BACKUP_MC_IMAGE:-${CETELE_OPS_MC_IMAGE_DEFAULT}}"
minio_image="${CETELE_DRILL_MINIO_IMAGE:-${CETELE_OPS_MINIO_IMAGE_DEFAULT}}"
require_tool docker
require_tool "${age_bin}"
require_tool "${keygen_bin}"
[ -d "${migrations_dir}" ] || die_config "migrations not found at ${migrations_dir}"

run_id="$(date +%s)-$$"
network="cetele-drill-net-${run_id}"
minio="cetele-drill-minio-${run_id}"
source_db="cetele-drill-source-${run_id}"
work_dir="$(mktemp -d)"

cleanup() {
  status=$?
  docker rm -f "${source_db}" "${minio}" >/dev/null 2>&1 || true
  docker network rm "${network}" >/dev/null 2>&1 || true
  rm -f "${work_dir}/identity.txt" "${work_dir}/other-identity.txt" "${work_dir}/expected.txt" \
    "${work_dir}/object.age" "${work_dir}/listing.json"
  rmdir "${work_dir}" 2>/dev/null || true
  echo "cleanup: removed ${source_db}, ${minio}, network ${network} and the run keys"
  exit "${status}"
}
trap cleanup EXIT
trap 'exit 1' INT TERM

echo "images: ${pg_image}, ${minio_image}, ${mc_image}"
echo "age: $("${age_bin}" --version)"

echo "== step 1: network, MinIO and the source database"
docker network create "${network}" >/dev/null
minio_root_user="drillroot$(random_hex 4)"
minio_root_password="$(random_hex 24)"
env "MINIO_ROOT_USER=${minio_root_user}" "MINIO_ROOT_PASSWORD=${minio_root_password}" \
  docker run -d --name "${minio}" --network "${network}" --network-alias minio \
  -e MINIO_ROOT_USER -e MINIO_ROOT_PASSWORD "${minio_image}" server /data >/dev/null
docker run -d --name "${source_db}" --network "${network}" \
  -e POSTGRES_USER=cetele -e POSTGRES_PASSWORD="drill-scratch-only" -e POSTGRES_DB=cetele \
  "${pg_image}" >/dev/null
ready=0
for _ in $(seq 1 90); do
  if docker exec "${source_db}" pg_isready -h 127.0.0.1 -U cetele -d cetele >/dev/null 2>&1 &&
    docker exec "${minio}" curl -fsS -o /dev/null http://127.0.0.1:9000/minio/health/ready >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
[ "${ready}" -eq 1 ] || fail "source database or MinIO did not become ready"
echo "ready: source PostgreSQL $(psql_at "${source_db}" cetele cetele -c 'SHOW server_version;'), MinIO"

CETELE_BACKUP_S3_ENDPOINT="http://minio:9000"
CETELE_BACKUP_DOCKER_NETWORK="${network}"
CETELE_BACKUP_MC_IMAGE="${mc_image}"
CETELE_BACKUP_AGE_BIN="${age_bin}"
CETELE_BACKUP_S3_WRITE_ACCESS_KEY="drillwriter$(random_hex 4)"
CETELE_BACKUP_S3_WRITE_SECRET_KEY="$(random_hex 24)"
CETELE_RESTORE_S3_READ_ACCESS_KEY="drillreader$(random_hex 4)"
CETELE_RESTORE_S3_READ_SECRET_KEY="$(random_hex 24)"
export CETELE_BACKUP_S3_ENDPOINT CETELE_BACKUP_DOCKER_NETWORK CETELE_BACKUP_MC_IMAGE CETELE_BACKUP_AGE_BIN \
  CETELE_BACKUP_S3_WRITE_ACCESS_KEY CETELE_BACKUP_S3_WRITE_SECRET_KEY \
  CETELE_RESTORE_S3_READ_ACCESS_KEY CETELE_RESTORE_S3_READ_SECRET_KEY
bucket="${CETELE_BACKUP_S3_BUCKET:-cetele-backups}"
prefix="${CETELE_BACKUP_S3_PREFIX-cetele/}"

echo "== step 2: buckets and identities"
CETELE_BACKUP_S3_ADMIN_ACCESS_KEY="${minio_root_user}" CETELE_BACKUP_S3_ADMIN_SECRET_KEY="${minio_root_password}" \
  sh "${script_dir}/bucket-setup.sh" || fail "bucket-setup.sh failed"

echo "== step 3: migrations and synthetic data"
migrations="$(for path in "${migrations_dir}"/V*__*.sql; do basename "${path}"; done | sed -n 's/^V\([0-9][0-9]*\)__.*\.sql$/\1 &/p' | sort -n | cut -d ' ' -f 2)"
[ -n "${migrations}" ] || fail "no migration files in ${migrations_dir}"
for file in ${migrations}; do
  psql_at "${source_db}" cetele cetele -1 -f - <"${migrations_dir}/${file}" >/dev/null || fail "migration ${file} failed"
  echo "applied: ${file}"
done
psql_at "${source_db}" cetele cetele <"${script_dir}/drill-seed.sql" >/dev/null || fail "drill-seed.sql failed"
echo "seeded: drill-seed.sql"

echo "== step 4: source fingerprint"
psql_at "${source_db}" cetele cetele <"${script_dir}/drill-stats.sql" | tr -d '\r' >"${work_dir}/expected.txt"
cat "${work_dir}/expected.txt"

echo "== step 5: run-only age key pair"
"${keygen_bin}" -o "$(native_path "${work_dir}/identity.txt")" 2>/dev/null
"${keygen_bin}" -o "$(native_path "${work_dir}/other-identity.txt")" 2>/dev/null
CETELE_BACKUP_AGE_RECIPIENT="$("${keygen_bin}" -y "$(native_path "${work_dir}/identity.txt")" | tr -d '\r')"
export CETELE_BACKUP_AGE_RECIPIENT
echo "recipient: public key of a run-only identity (the identity stays in a 0600 temp file)"

echo "== step 6: backup.sh"
CETELE_BACKUP_PG_CONTAINER="${source_db}" sh "${script_dir}/backup.sh" || fail "backup.sh failed"

echo "== step 7: negative checks"
mc_w() {
  mc_run w "${CETELE_BACKUP_S3_ENDPOINT}" "${CETELE_BACKUP_S3_WRITE_ACCESS_KEY}" "${CETELE_BACKUP_S3_WRITE_SECRET_KEY}" "${mc_image}" "${network}" -- "$@"
}
mc_r() {
  mc_run r "${CETELE_BACKUP_S3_ENDPOINT}" "${CETELE_RESTORE_S3_READ_ACCESS_KEY}" "${CETELE_RESTORE_S3_READ_SECRET_KEY}" "${mc_image}" "${network}" -- "$@"
}
mc_r ls --json "r/${bucket}/${prefix}" >"${work_dir}/listing.json" || fail "the reader cannot list"
object="${prefix}$(sed -n 's/.*"key":"\(cetele-[0-9T]*Z\.dump\.age\)".*/\1/p' "${work_dir}/listing.json" | sort | tail -n 1)"
echo "stored: ${object}"
if mc_w ls "w/${bucket}/${prefix}" >/dev/null 2>&1; then fail "the write-only identity could list the bucket"; fi
echo "writer list: denied (expected)"
if mc_w cat "w/${bucket}/${object}" >/dev/null 2>&1; then fail "the write-only identity could read a dump"; fi
echo "writer read: denied (expected)"
if mc_w rm "w/${bucket}/${object}" >/dev/null 2>&1; then fail "the write-only identity could delete a dump"; fi
echo "writer delete: denied (expected)"
if echo probe | mc_r pipe "r/${bucket}/${prefix}probe.txt" >/dev/null 2>&1; then fail "the read-only identity could write"; fi
echo "reader write: denied (expected)"
mc_r cat "r/${bucket}/${object}" >"${work_dir}/object.age" || fail "the reader cannot download ${object}"
if grep -a -q 'Drill customer' "${work_dir}/object.age"; then fail "seeded plain text found in the stored object"; fi
echo "stored object: no seeded plain text ('Drill customer' not found in $(file_size "${work_dir}/object.age") bytes)"
if "${age_bin}" -d -i "$(native_path "${work_dir}/other-identity.txt")" <"${work_dir}/object.age" >/dev/null 2>&1; then
  fail "another identity could decrypt the dump"
fi
echo "decrypt with another identity: refused (expected)"

echo "== step 8: restore-drill.sh"
CETELE_RESTORE_AGE_IDENTITY_FILE="${work_dir}/identity.txt" CETELE_DRILL_EXPECTED="${work_dir}/expected.txt" \
  sh "${script_dir}/restore-drill.sh" || fail "restore-drill.sh failed"

echo "RESULT: end-to-end drill passed"
