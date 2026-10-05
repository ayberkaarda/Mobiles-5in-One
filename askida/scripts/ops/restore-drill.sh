#!/usr/bin/env bash
# Restore drill for the encrypted backup archives of `php artisan backup:run` (security item 20,
# docs/ops/backup-restore.md).
#
#   1. take the newest archive: DRILL_ARCHIVE (a local .zip), or the newest
#      <DRILL_S3_PREFIX>*.zip in the backup bucket, fetched with the read-only restore identity
#   2. decrypt it with BACKUP_ARCHIVE_PASSWORD and stream db-dumps/*.sql out of it (the plain
#      dump never touches the disk)
#   3. start a disposable PostGIS container (no published port, no volume) and restore the dump
#      into a new database created from template0
#   4. check the hook invariants:
#        count(hooks) = SUM(donations.qty) over donations whose hooks were issued
#        no hook outside AVAILABLE, RESERVED, REDEEMED, EXPIRED
#   5. remove the container by its exact name (also on failure or interrupt)
#
# Usage: scripts/ops/restore-drill.sh [--help]
#
# Required environment:
#   BACKUP_ARCHIVE_PASSWORD             archive password (the value the application encrypts with)
# Archive source, exactly one of:
#   DRILL_ARCHIVE                       path of a local archive
#   DRILL_S3_ENDPOINT                   S3 API endpoint (https; http only for localhost, 127.0.0.1,
#                                       host.docker.internal or a name on DRILL_DOCKER_NETWORK)
#     with BACKUP_RESTORE_ACCESS_KEY_ID and BACKUP_RESTORE_SECRET_ACCESS_KEY, the restore
#     identity (get and list only); never the application key
# Optional:
#   DRILL_S3_BUCKET        default askida-backups
#   DRILL_S3_PREFIX        default askida/ (the backup name in config/backup.php)
#   DRILL_DOCKER_NETWORK   docker network for the bucket client container (for example the
#                          compose network, so DRILL_S3_ENDPOINT can be http://minio:9000)
#   DRILL_PHP_IMAGE        image that decrypts the archive (PHP with zip and AES); empty uses
#                          `php` on PATH. Default askida-server:local (built by docker-compose.yml)
#   DRILL_MC_IMAGE         bucket client image, default the minio-init image of docker-compose.yml
#   DRILL_PG_IMAGE         default postgis/postgis:16-3.5-alpine (PostgreSQL 16 with a psql that
#                          understands the \restrict lines of current pg_dump 16 minors)
#   DRILL_DB_OWNER         role the dump assigns ownership to, default askida
#
# Credentials and the password reach the containers only through environment variables, never
# as arguments, and are never printed. No shell tracing. Exit codes: 0 drill passed, 1 a step or
# check failed, 2 usage or configuration error.
set -euo pipefail
set +x
umask 077

# Git Bash on Windows must not rewrite container paths.
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL='*'

usage() {
  sed -n '2,/^set -euo pipefail$/p' "$0" | sed -e '$d' -e 's/^# \{0,1\}//'
}

die_config() {
  echo "restore-drill: $*" >&2
  exit 2
}

fail() {
  echo "restore-drill: FAIL $*" >&2
  exit 1
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

BUCKET="${DRILL_S3_BUCKET:-askida-backups}"
PREFIX="${DRILL_S3_PREFIX:-askida/}"
PHP_IMAGE="${DRILL_PHP_IMAGE-askida-server:local}"
MC_IMAGE="${DRILL_MC_IMAGE:-pgsty/mc:RELEASE.2026-09-16T00-00-00Z}"
PG_IMAGE="${DRILL_PG_IMAGE:-postgis/postgis:16-3.5-alpine}"
DB_OWNER="${DRILL_DB_OWNER:-askida}"
NETWORK="${DRILL_DOCKER_NETWORK:-}"

missing=()
[ -n "${BACKUP_ARCHIVE_PASSWORD:-}" ] || missing+=("BACKUP_ARCHIVE_PASSWORD")
if [ -n "${DRILL_ARCHIVE:-}" ] && [ -n "${DRILL_S3_ENDPOINT:-}" ]; then
  die_config "set either DRILL_ARCHIVE or DRILL_S3_ENDPOINT, not both"
fi
if [ -z "${DRILL_ARCHIVE:-}" ]; then
  [ -n "${DRILL_S3_ENDPOINT:-}" ] || missing+=("DRILL_ARCHIVE or DRILL_S3_ENDPOINT")
  for name in BACKUP_RESTORE_ACCESS_KEY_ID BACKUP_RESTORE_SECRET_ACCESS_KEY; do
    [ -n "${!name:-}" ] || missing+=("${name}")
  done
fi
if [ "${#missing[@]}" -gt 0 ]; then
  die_config "refusing to run, missing environment: $(printf '%s, ' "${missing[@]}" | sed 's/, $//')"
fi

if [ -n "${DRILL_ARCHIVE:-}" ]; then
  [ -f "${DRILL_ARCHIVE}" ] || die_config "DRILL_ARCHIVE is not a file: ${DRILL_ARCHIVE}"
else
  case "${DRILL_S3_ENDPOINT}" in
    https://*) ;;
    http://localhost* | http://127.0.0.1* | http://host.docker.internal*) ;;
    http://*)
      [ -n "${NETWORK}" ] || die_config "DRILL_S3_ENDPOINT must use https (plain http only for local addresses or a DRILL_DOCKER_NETWORK name)"
      ;;
    *) die_config "DRILL_S3_ENDPOINT must be an http(s) URL" ;;
  esac
  if ! [[ "${BUCKET}" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]]; then
    die_config "DRILL_S3_BUCKET is not a valid bucket name"
  fi
  if ! [[ "${PREFIX}" =~ ^[A-Za-z0-9._/-]{0,64}$ ]]; then
    die_config "DRILL_S3_PREFIX may only contain letters, digits, '.', '_', '/' and '-'"
  fi
fi
if ! [[ "${DB_OWNER}" =~ ^[a-z_][a-z0-9_]{0,62}$ ]]; then
  die_config "DRILL_DB_OWNER is not a plain role name"
fi

command -v docker >/dev/null 2>&1 || die_config "required tool not found on PATH: docker"
if [ -z "${PHP_IMAGE}" ]; then
  command -v php >/dev/null 2>&1 || die_config "DRILL_PHP_IMAGE is empty and php is not on PATH"
fi

RUN_ID="$(date +%s)-$$"
DB_CONTAINER="askida-restore-drill-${RUN_ID}"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/askida-restore-drill.XXXXXX")"
ARCHIVE="${WORK_DIR}/archive.zip"

cleanup() {
  status=$?
  docker rm -f "${DB_CONTAINER}" >/dev/null 2>&1 || true
  rm -f "${ARCHIVE}"
  rmdir "${WORK_DIR}" 2>/dev/null || true
  echo "cleanup: removed container ${DB_CONTAINER} and the downloaded archive"
  exit "${status}"
}
trap cleanup EXIT INT TERM

# Percent-encodes a value for the user-info part of a URL.
urlencode() {
  local raw="$1" out="" c i
  for ((i = 0; i < ${#raw}; i++)); do
    c="${raw:i:1}"
    case "${c}" in
      [A-Za-z0-9._~-]) out+="${c}" ;;
      *) out+="$(printf '%%%02X' "'${c}")" ;;
    esac
  done
  printf '%s' "${out}"
}

# mc_run <mc args...>: the restore identity travels as MC_HOST_drill in the environment only.
mc_run() {
  local scheme="${DRILL_S3_ENDPOINT%%://*}" host="${DRILL_S3_ENDPOINT#*://}"
  host="${host%/}"
  local network_args=()
  [ -z "${NETWORK}" ] || network_args=(--network "${NETWORK}")
  MC_HOST_drill="${scheme}://$(urlencode "${BACKUP_RESTORE_ACCESS_KEY_ID}"):$(urlencode "${BACKUP_RESTORE_SECRET_ACCESS_KEY}")@${host}" \
    docker run --rm -i "${network_args[@]}" -e MC_HOST_drill "${MC_IMAGE}" "$@"
}

# PHP that reads the archive on stdin and writes the single db-dumps/*.sql entry to stdout.
# Refuses an archive whose dump entry is not encrypted; a wrong password fails the read.
# shellcheck disable=SC2016
EXTRACT_PHP='
$tmp = tempnam(sys_get_temp_dir(), "drill");
$out = fopen($tmp, "wb");
stream_copy_to_stream(STDIN, $out);
fclose($out);
$zip = new ZipArchive();
if ($zip->open($tmp, ZipArchive::RDONLY) !== true) { fwrite(STDERR, "not a readable zip archive\n"); exit(1); }
$zip->setPassword((string) getenv("BACKUP_ARCHIVE_PASSWORD"));
$dumps = [];
$documents = 0;
for ($i = 0; $i < $zip->numFiles; $i++) {
    $stat = $zip->statIndex($i);
    if (preg_match("#(^|/)db-dumps/[^/]+\.sql$#", $stat["name"])) { $dumps[] = $stat; }
    elseif (substr($stat["name"], -1) !== "/") { $documents++; }
}
if (count($dumps) !== 1) { fwrite(STDERR, "expected one db-dumps/*.sql entry, found ".count($dumps)."\n"); exit(1); }
$dump = $dumps[0];
if ($dump["encryption_method"] === ZipArchive::EM_NONE) { fwrite(STDERR, "the dump entry is not encrypted\n"); exit(1); }
$in = $zip->getStreamIndex($dump["index"]);
if ($in === false) { fwrite(STDERR, "cannot open the dump entry (wrong password?)\n"); exit(1); }
$copied = stream_copy_to_stream($in, STDOUT);
fclose($in);
$status = $zip->getStatusString();
$zip->close();
unlink($tmp);
if ($copied !== $dump["size"]) { fwrite(STDERR, "dump entry could not be decrypted (wrong password?)\n"); exit(1); }
fwrite(STDERR, "archive: dump ".$dump["name"]." (".$dump["size"]." bytes, encrypted), ".$documents." other files\n");
'

extract_dump() {
  if [ -n "${PHP_IMAGE}" ]; then
    docker run --rm -i -e BACKUP_ARCHIVE_PASSWORD --entrypoint php "${PHP_IMAGE}" -r "${EXTRACT_PHP}"
  else
    php -r "${EXTRACT_PHP}"
  fi
}

psql_drill() {
  docker exec -i "${DB_CONTAINER}" psql -X -q -v ON_ERROR_STOP=1 -U "${DB_OWNER}" "$@"
}

echo "== step 1: take the newest archive"
if [ -n "${DRILL_ARCHIVE:-}" ]; then
  cp "${DRILL_ARCHIVE}" "${ARCHIVE}"
  echo "source: local file $(basename "${DRILL_ARCHIVE}")"
else
  LISTING="$(mc_run ls --json "drill/${BUCKET}/${PREFIX}")" || fail "cannot list s3://${BUCKET}/${PREFIX} with the restore identity"
  NEWEST="$(printf '%s\n' "${LISTING}" | sed -n 's/.*"key":"\([^"]*\.zip\)".*/\1/p' | sort | tail -n 1)"
  [ -n "${NEWEST}" ] || fail "no archive under s3://${BUCKET}/${PREFIX}"
  echo "source: s3://${BUCKET}/${PREFIX}${NEWEST} ($(printf '%s\n' "${LISTING}" | grep -c '"key":"[^"]*\.zip"') archives listed)"
  mc_run cat "drill/${BUCKET}/${PREFIX}${NEWEST}" >"${ARCHIVE}" || fail "cannot download the archive with the restore identity"
fi
echo "archive size: $(wc -c <"${ARCHIVE}" | tr -d ' ') bytes"

echo "== step 2: start a disposable database (${PG_IMAGE})"
# Throwaway password: the container publishes no port and is removed at the end.
docker run -d --name "${DB_CONTAINER}" \
  -e POSTGRES_USER="${DB_OWNER}" -e POSTGRES_PASSWORD="drill-scratch-only" -e POSTGRES_DB=postgres \
  "${PG_IMAGE}" >/dev/null
ready=0
for _ in $(seq 1 90); do
  # Only the final server listens on TCP; the init-time server uses the socket only.
  if docker exec "${DB_CONTAINER}" pg_isready -h 127.0.0.1 -U "${DB_OWNER}" -d postgres >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
[ "${ready}" -eq 1 ] || fail "database container did not become ready"
psql_drill -d postgres -c "CREATE DATABASE restored TEMPLATE template0;"

echo "== step 3: decrypt and restore"
extract_dump <"${ARCHIVE}" | psql_drill -d restored >/dev/null || fail "decrypting or restoring the dump failed"
echo "restore: done"

echo "== step 4: verify"
TABLES="$(psql_drill -d restored -At -c "SELECT count(*) FROM pg_tables WHERE schemaname = 'public';")"
echo "restored tables in public: ${TABLES}"
for table in hooks donations; do
  [ "$(psql_drill -d restored -At -c "SELECT to_regclass('public.${table}') IS NOT NULL;")" = "t" ] ||
    fail "table ${table} missing in the restored database"
done
HOOKS="$(psql_drill -d restored -At -c "SELECT count(*) FROM hooks;")"
ISSUED="$(psql_drill -d restored -At -c "SELECT COALESCE(SUM(qty), 0) FROM donations WHERE hooks_issued_at IS NOT NULL;")"
UNKNOWN="$(psql_drill -d restored -At -c "SELECT count(*) FROM hooks WHERE status NOT IN ('AVAILABLE', 'RESERVED', 'REDEEMED', 'EXPIRED');")"
DONATIONS="$(psql_drill -d restored -At -c "SELECT count(*) FROM donations;")"
echo "donations: ${DONATIONS}, units issued: ${ISSUED}, hooks: ${HOOKS}, hooks with an unknown status: ${UNKNOWN}"
[ "${HOOKS}" = "${ISSUED}" ] || fail "hook count ${HOOKS} differs from the issued units ${ISSUED}"
[ "${UNKNOWN}" = "0" ] || fail "${UNKNOWN} hooks have a status outside AVAILABLE, RESERVED, REDEEMED, EXPIRED"
echo "hook invariants: hold"

echo "RESULT: restore drill passed"
