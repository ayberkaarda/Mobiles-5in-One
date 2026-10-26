#!/usr/bin/env bash
# Patika restore drill (security checklist item 20, docs/ops/backup-restore.md).
#
# End to end on throwaway containers: a source PostGIS, a separate restore PostGIS, a MinIO bucket
# with versioning and a tools container (PostgreSQL 17 client, age, aws CLI). The source is migrated
# with the EF migrations (`dotnet ef database update`, the same migrations the API applies), seeded
# with drill-seed.sql and fingerprinted with smoke.sql. backup.sh then dumps, encrypts and uploads;
# the drill downloads the dump from the bucket and restore.sh restores it into the second server and
# diffs the smoke rows against the source. Negative runs (wrong identity, corrupted file, wrong
# expectation, existing target database) must each fail on their named check, and an old local
# backup must be pruned. Every key pair and password is created here and thrown away.
#
# Runs from Git Bash on Windows and on Linux CI. Needs docker and the .NET SDK. Prints
# "RESULT: restore drill passed" on success.
set -euo pipefail
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "${here}/../.." && pwd)"
pg_image="${PATIKA_DRILL_PG_IMAGE:-postgis/postgis:17-3.5}"
minio_image="${PATIKA_DRILL_MINIO_IMAGE:-pgsty/minio:RELEASE.2026-08-04T00-00-00Z}"
# Client tools: PostgreSQL 17 client from the official image (Debian bookworm), plus age and the aws CLI.
tools_base="${PATIKA_DRILL_TOOLS_BASE:-postgres:17-bookworm}"
run_id="patika-drill-$(date -u +%H%M%S)-${RANDOM}"
net="${run_id}-net"
src="${run_id}-src"
dst="${run_id}-dst"
minio="${run_id}-minio"
tools="${run_id}-tools"
tools_image="patika-backup-tools:drill"
db_password="drill-$(od -An -N12 -tx1 /dev/urandom | tr -d ' \n')"
s3_key="drill$(od -An -N6 -tx1 /dev/urandom | tr -d ' \n')"
s3_secret="$(od -An -N18 -tx1 /dev/urandom | tr -d ' \n')"

step() { printf '\n== %s\n' "$*"; }
fail() { printf 'drill: FAIL %s\n' "$*" >&2; exit 1; }

cleanup() {
  docker rm -f "${src}" "${dst}" "${minio}" "${tools}" >/dev/null 2>&1 || true
  docker network rm "${net}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

in_tools() { docker exec "$@"; }
put_file() { docker exec -i "${tools}" sh -c "cat > '$2'" < "$1"; }

wait_pg() {
  local name="$1"
  for _ in $(seq 1 60); do
    # TCP, not the socket: the image's init phase runs a socket-only server and then restarts.
    if docker exec "${name}" pg_isready -h 127.0.0.1 -U patika -d patika >/dev/null 2>&1 \
      && docker exec -e PGPASSWORD="${db_password}" "${name}" psql -h 127.0.0.1 -U patika -d patika -tAc 'SELECT 1' >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  fail "${name} did not become ready"
}

step "containers (${run_id})"
docker network create "${net}" >/dev/null
for name in "${src}" "${dst}"; do
  docker run -d --name "${name}" --network "${net}" -e POSTGRES_USER=patika -e POSTGRES_DB=patika \
    -e POSTGRES_PASSWORD="${db_password}" -p 127.0.0.1::5432 "${pg_image}" >/dev/null
done
docker run -d --name "${minio}" --network "${net}" -e MINIO_ROOT_USER="${s3_key}" -e MINIO_ROOT_PASSWORD="${s3_secret}" \
  "${minio_image}" server /data >/dev/null
docker build --quiet -t "${tools_image}" - >/dev/null <<EOF
FROM ${tools_base}
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends age awscli >/dev/null && rm -rf /var/lib/apt/lists/*
EOF
docker run -d --name "${tools}" --network "${net}" --entrypoint sleep "${tools_image}" infinity >/dev/null
wait_pg "${src}"
wait_pg "${dst}"
docker exec "${tools}" sh -c 'mkdir -p /drill/out /drill/download && pg_dump --version && age --version && aws --version 2>&1'
src_port="$(docker port "${src}" 5432/tcp | head -1 | sed 's/.*://')"
echo "source PostGIS on 127.0.0.1:${src_port}; restore target ${dst} has no host port"

step "migrate source with the EF migrations"
(
  cd "${root}"
  dotnet tool restore >/dev/null
  dotnet build src/Patika.Infrastructure -v q -nologo -clp:ErrorsOnly >/dev/null
  PATIKA_DB="Host=127.0.0.1;Port=${src_port};Database=patika;Username=patika;Password=${db_password}" \
    dotnet ef database update --no-build --project src/Patika.Infrastructure --startup-project src/Patika.Infrastructure \
    | grep -E "^(Applying migration|Done)" || true
)

step "seed synthetic data and fingerprint the source"
docker exec -i "${src}" psql -U patika -d patika -v ON_ERROR_STOP=1 -q < "${here}/drill-seed.sql"
for file in backup.sh restore.sh smoke.sql; do put_file "${here}/${file}" "/drill/${file}"; done
docker exec -i "${src}" psql -U patika -d patika -v ON_ERROR_STOP=1 -X -q -tA -F'|' < "${here}/smoke.sql" > "${here}/.drill-expected.txt"
trap 'rm -f "${here}/.drill-expected.txt"; cleanup' EXIT
cat "${here}/.drill-expected.txt"
put_file "${here}/.drill-expected.txt" /drill/expected.txt

step "keys and bucket"
in_tools "${tools}" sh -c 'umask 077 && age-keygen -o /drill/identity.txt 2>/dev/null && age-keygen -o /drill/wrong-identity.txt 2>/dev/null'
recipient="$(in_tools "${tools}" age-keygen -y /drill/identity.txt)"
echo "recipient ${recipient:0:12}... (identity file stays inside the tools container)"
aws_env=(-e AWS_ACCESS_KEY_ID="${s3_key}" -e AWS_SECRET_ACCESS_KEY="${s3_secret}" -e AWS_DEFAULT_REGION=us-east-1)
s3=(aws --endpoint-url "http://${minio}:9000")
for _ in $(seq 1 30); do
  in_tools "${aws_env[@]}" "${tools}" "${s3[@]}" s3 mb s3://patika-backups >/dev/null 2>&1 && break
  sleep 1
done
in_tools "${aws_env[@]}" "${tools}" "${s3[@]}" s3api put-bucket-versioning --bucket patika-backups \
  --versioning-configuration Status=Enabled
echo "versioning: $(in_tools "${aws_env[@]}" "${tools}" "${s3[@]}" s3api get-bucket-versioning --bucket patika-backups --output text)"

step "backup.sh (with an expired local file to prune)"
in_tools "${tools}" sh -c 'touch -d "40 days ago" /drill/out/patika-20000101T000000Z.dump.age /drill/out/patika-20000101T000000Z.dump.age.sha256'
in_tools "${aws_env[@]}" -e PGHOST="${src}" -e PGUSER=patika -e PGPASSWORD="${db_password}" -e PGDATABASE=patika \
  -e PATIKA_BACKUP_AGE_RECIPIENT="${recipient}" -e PATIKA_BACKUP_DIR=/drill/out \
  -e PATIKA_BACKUP_S3_URI=s3://patika-backups/db -e PATIKA_BACKUP_S3_ENDPOINT="http://${minio}:9000" \
  "${tools}" bash /drill/backup.sh
in_tools "${tools}" sh -c 'ls /drill/out/patika-20000101T000000Z.dump.age 2>/dev/null' && fail "expired local backup was not pruned"
name="$(in_tools "${tools}" sh -c 'ls /drill/out | grep -E "^patika-[0-9TZ]+\.dump\.age$" | tail -1')"
[[ -n "${name}" ]] || fail "backup.sh wrote no dump"
header="$(in_tools "${tools}" head -c 21 "/drill/out/${name}")"
[[ "${header}" == "age-encryption.org/v1" ]] || fail "backup is not an age file (header: ${header})"
if in_tools "${tools}" grep -a -q -e 'DRILL' -e 'example.invalid' "/drill/out/${name}"; then
  fail "plaintext seed markers found in the encrypted backup"
fi
echo "encrypted file header: ${header}; no plaintext seed markers"
in_tools "${aws_env[@]}" "${tools}" "${s3[@]}" s3 ls s3://patika-backups/db/

step "download from the bucket and restore.sh into the second server"
in_tools "${aws_env[@]}" "${tools}" "${s3[@]}" s3 cp --only-show-errors "s3://patika-backups/db/${name}" "/drill/download/${name}"
in_tools "${aws_env[@]}" "${tools}" "${s3[@]}" s3 cp --only-show-errors "s3://patika-backups/db/${name}.sha256" "/drill/download/${name}.sha256"
restore_env=(-e PGHOST="${dst}" -e PGUSER=patika -e PGPASSWORD="${db_password}" -e PATIKA_BACKUP_AGE_IDENTITY=/drill/identity.txt)
in_tools "${restore_env[@]}" -e PATIKA_RESTORE_EXPECT=/drill/expected.txt "${tools}" bash /drill/restore.sh "/drill/download/${name}" \
  || fail "restore of the downloaded dump failed"

expect_failure() {
  local label="$1" pattern="$2" output status
  shift 2
  set +e
  output="$("$@" 2>&1)"
  status=$?
  set -e
  if [[ "${status}" -eq 0 ]] || ! grep -Eq "${pattern}" <<<"${output}"; then
    printf '%s\n' "${output}"
    fail "negative run '${label}' was not caught (exit ${status})"
  fi
  printf 'negative %-18s exit %s: %s\n' "${label}" "${status}" "$(grep -E "${pattern}" <<<"${output}" | head -1)"
}

step "negative runs"
expect_failure wrong-identity 'FAIL age could not decrypt' \
  docker exec -e PGHOST="${dst}" -e PGUSER=patika -e PGPASSWORD="${db_password}" -e PATIKA_BACKUP_AGE_IDENTITY=/drill/wrong-identity.txt \
  -e PATIKA_RESTORE_DB=patika_neg_identity "${tools}" bash /drill/restore.sh "/drill/download/${name}"
in_tools "${tools}" sh -c "cp /drill/download/${name} /drill/corrupt.dump.age && cp /drill/download/${name}.sha256 /drill/corrupt.dump.age.sha256 \
  && printf 'X' | dd of=/drill/corrupt.dump.age bs=1 seek=200 conv=notrunc 2>/dev/null"
expect_failure corrupted-file 'FAIL checksum mismatch' \
  docker exec "${restore_env[@]}" -e PATIKA_RESTORE_DB=patika_neg_corrupt "${tools}" bash /drill/restore.sh /drill/corrupt.dump.age
in_tools "${tools}" sh -c 'rm /drill/corrupt.dump.age.sha256'
expect_failure corrupted-no-sum 'FAIL age could not decrypt' \
  docker exec "${restore_env[@]}" -e PATIKA_RESTORE_DB=patika_neg_corrupt2 "${tools}" bash /drill/restore.sh /drill/corrupt.dump.age
in_tools "${tools}" sh -c "sed 's/^stations|\([0-9]*\)$/stations|999/' /drill/expected.txt > /drill/wrong-expected.txt"
expect_failure smoke-mismatch 'FAIL smoke mismatch' \
  docker exec "${restore_env[@]}" -e PATIKA_RESTORE_DB=patika_neg_smoke -e PATIKA_RESTORE_EXPECT=/drill/wrong-expected.txt \
  "${tools}" bash /drill/restore.sh "/drill/download/${name}"
expect_failure existing-target 'FAIL target database exists' \
  docker exec "${restore_env[@]}" "${tools}" bash /drill/restore.sh "/drill/download/${name}"

printf '\nRESULT: restore drill passed\n'
