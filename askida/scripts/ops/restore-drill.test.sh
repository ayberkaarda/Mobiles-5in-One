#!/usr/bin/env bash
# Checks of scripts/ops/restore-drill.sh: argument and environment validation, the restore and
# the hook invariant checks against fixture archives built at run time (a passing one, a broken
# count, an unknown status, a wrong password, an unencrypted archive), and the bucket path with
# a stand-in for the bucket client (newest key chosen, credentials only in the environment).
# Needs docker and the image that decrypts archives (DRILL_PHP_IMAGE, default
# askida-server:local; empty uses php on PATH). Run: bash scripts/ops/restore-drill.test.sh
#
# The archive password and the restore credentials are assembled at run time, so no literal
# secret exists in the repository.
set -uo pipefail

export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL='*'

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="${HERE}/restore-drill.sh"
SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/askida-restore-drill-test.XXXXXX")"
trap 'rm -rf -- "${SANDBOX}"' EXIT
PHP_IMAGE="${DRILL_PHP_IMAGE-askida-server:local}"
MC_IMAGE="pgsty/mc:RELEASE.2026-09-16T00-00-00Z"
REAL_DOCKER="$(command -v docker)" || {
  echo "docker is required"
  exit 1
}
STUBS="${SANDBOX}/bin"
mkdir -p "${STUBS}"

PASSED=0
FAILED=0
ok() {
  PASSED=$((PASSED + 1))
  echo "ok   - $1"
}
not_ok() {
  FAILED=$((FAILED + 1))
  echo "FAIL - $1"
  [ -z "${2:-}" ] || printf '       %s\n' "$2"
}

# Run-time dummy values; the secret holds characters that need URL encoding.
STAMP="$(date +%s)"
PASSWORD="drill${STAMP}pw$$"
RESTORE_KEY_ID="restore${STAMP}"
RESTORE_SECRET="rs/${STAMP}+x$$"

# make_archive <sql file> <password or empty> <output zip>
make_archive() {
  # shellcheck disable=SC2016 # PHP code: PHP expands these variables, not the shell
  local code='
$path = tempnam(sys_get_temp_dir(), "fixture");
$zip = new ZipArchive();
$zip->open($path, ZipArchive::CREATE | ZipArchive::OVERWRITE);
$zip->addFromString("db-dumps/postgresql-askida.sql", stream_get_contents(STDIN));
$zip->addFromString("private/documents/sample.txt", "sample document\n");
$password = (string) getenv("FIXTURE_PASSWORD");
if ($password !== "") {
    foreach (["db-dumps/postgresql-askida.sql", "private/documents/sample.txt"] as $name) {
        $zip->setEncryptionName($name, ZipArchive::EM_AES_256, $password);
    }
}
$zip->close();
readfile($path);
unlink($path);
'
  if [ -n "${PHP_IMAGE}" ]; then
    FIXTURE_PASSWORD="$2" "${REAL_DOCKER}" run --rm -i -e FIXTURE_PASSWORD --entrypoint php "${PHP_IMAGE}" -r "${code}" <"$1" >"$3"
  else
    FIXTURE_PASSWORD="$2" php -r "${code}" <"$1" >"$3"
  fi
}

# Fixture dump: plain SQL as pg_dump writes it, reduced to the two tables the drill checks.
# Three donations, two of them issued (2 + 1 units), three hooks.
BASE_SQL="${SANDBOX}/base.sql"
cat >"${BASE_SQL}" <<'SQL'
SET client_encoding = 'UTF8';
CREATE TABLE public.donations (id bigint PRIMARY KEY, qty smallint NOT NULL, hooks_issued_at timestamp with time zone);
CREATE TABLE public.hooks (id bigint PRIMARY KEY, donation_id bigint NOT NULL REFERENCES public.donations (id), status character varying(16) NOT NULL);
INSERT INTO public.donations VALUES (1, 2, '2026-10-01 10:00:00+03'), (2, 1, '2026-10-02 11:00:00+03'), (3, 4, NULL);
INSERT INTO public.hooks VALUES (1, 1, 'AVAILABLE'), (2, 1, 'REDEEMED'), (3, 2, 'RESERVED');
SQL
{
  cat "${BASE_SQL}"
  echo "INSERT INTO public.hooks VALUES (4, 3, 'AVAILABLE');"
} >"${SANDBOX}/extra-hook.sql"
sed "s/(3, 2, 'RESERVED')/(3, 2, 'LOST')/" "${BASE_SQL}" >"${SANDBOX}/unknown-status.sql"

make_archive "${BASE_SQL}" "${PASSWORD}" "${SANDBOX}/good.zip"
make_archive "${SANDBOX}/extra-hook.sql" "${PASSWORD}" "${SANDBOX}/extra-hook.zip"
make_archive "${SANDBOX}/unknown-status.sql" "${PASSWORD}" "${SANDBOX}/unknown-status.zip"
make_archive "${BASE_SQL}" "" "${SANDBOX}/plain.zip"
for f in good extra-hook unknown-status plain; do
  [ -s "${SANDBOX}/${f}.zip" ] || {
    echo "could not build the fixture archive ${f}.zip"
    exit 1
  }
done

# Stand-in for docker: calls that use the bucket client image are answered here (a listing of
# three archives plus a non-archive key, or the good fixture for `cat`) and recorded; every
# other call goes to the real docker.
cat >"${STUBS}/docker" <<'STUB'
#!/usr/bin/env bash
for arg in "$@"; do
  if [ "${arg}" = "${STUB_MC_IMAGE}" ]; then
    printf '%s\n' "$@" >>"${STUB_LOG}"
    if [ "${MC_HOST_drill:-}" = "${STUB_EXPECT_MC_HOST}" ]; then echo "mc_host=expected" >>"${STUB_LOG}"; else echo "mc_host=unexpected" >>"${STUB_LOG}"; fi
    case " $* " in
      *" ls "*)
        printf '{"status":"success","type":"file","key":"%s"}\n' 2026-10-01-03-30-00.zip 2026-10-03-03-30-00.zip notes.txt 2026-10-02-03-30-00.zip
        ;;
      *" cat "*) cat "${STUB_ARCHIVE}" ;;
    esac
    exit 0
  fi
done
exec "${REAL_DOCKER}" "$@"
STUB
chmod +x "${STUBS}/docker"
STUB_LOG="${SANDBOX}/mc.log"

ALL_OUTPUT=""
# run <env assignments...> -- <script args...>; sets CODE and OUT (stdout and stderr).
run() {
  local envs=()
  while [ "$#" -gt 0 ] && [ "$1" != "--" ]; do
    envs+=("$1")
    shift
  done
  [ "$#" -eq 0 ] || shift
  OUT="$(env -u BACKUP_ARCHIVE_PASSWORD -u DRILL_ARCHIVE -u DRILL_S3_ENDPOINT -u DRILL_DOCKER_NETWORK \
    -u BACKUP_RESTORE_ACCESS_KEY_ID -u BACKUP_RESTORE_SECRET_ACCESS_KEY \
    TMPDIR="${SANDBOX}" DRILL_PHP_IMAGE="${PHP_IMAGE}" "${envs[@]}" bash "${SCRIPT}" "$@" 2>&1)"
  CODE=$?
  ALL_OUTPUT="${ALL_OUTPUT}${OUT}"$'\n'
}

expect() { # expect <name> <code> <substring>
  if [ "${CODE}" -eq "$2" ] && [[ "${OUT}" == *"$3"* ]]; then
    ok "$1"
  else
    not_ok "$1" "exit ${CODE}, output: ${OUT}"
  fi
}

expect_failed_check() { # expect_failed_check <name> <substring>
  if [ "${CODE}" -eq 1 ] && [[ "${OUT}" == *"$2"* ]] && [[ "${OUT}" != *"RESULT: restore drill passed"* ]] &&
    [[ "${OUT}" == *"cleanup: removed container"* ]]; then
    ok "$1"
  else
    not_ok "$1" "exit ${CODE}, output: ${OUT}"
  fi
}

run --
expect "refuses without environment and names every missing variable" 2 \
  "missing environment: BACKUP_ARCHIVE_PASSWORD, DRILL_ARCHIVE or DRILL_S3_ENDPOINT, BACKUP_RESTORE_ACCESS_KEY_ID, BACKUP_RESTORE_SECRET_ACCESS_KEY"

run "BACKUP_ARCHIVE_PASSWORD=${PASSWORD}" "DRILL_ARCHIVE=${SANDBOX}/good.zip" "DRILL_S3_ENDPOINT=https://s3.example.test" --
expect "refuses two archive sources" 2 "either DRILL_ARCHIVE or DRILL_S3_ENDPOINT"

run -- --bogus
expect "rejects an unknown argument" 2 "unknown argument: --bogus"

run -- --help
expect "--help prints the usage" 0 "Usage: scripts/ops/restore-drill.sh"

run "BACKUP_ARCHIVE_PASSWORD=${PASSWORD}" "DRILL_ARCHIVE=${SANDBOX}/missing.zip" --
expect "rejects a missing archive file" 2 "DRILL_ARCHIVE is not a file"

S3_ENV=(
  "BACKUP_ARCHIVE_PASSWORD=${PASSWORD}"
  "BACKUP_RESTORE_ACCESS_KEY_ID=${RESTORE_KEY_ID}"
  "BACKUP_RESTORE_SECRET_ACCESS_KEY=${RESTORE_SECRET}"
)
run "${S3_ENV[@]}" "DRILL_S3_ENDPOINT=http://backups.example.test" --
expect "rejects a plain-http endpoint that is not local" 2 "DRILL_S3_ENDPOINT must use https"

run "${S3_ENV[@]}" "DRILL_S3_ENDPOINT=https://s3.example.test" "DRILL_S3_BUCKET=Bad_Bucket" --
expect "rejects an invalid bucket name" 2 "DRILL_S3_BUCKET is not a valid bucket name"

run "${S3_ENV[@]}" "DRILL_S3_ENDPOINT=https://s3.example.test" "DRILL_S3_PREFIX=askida dumps/" --
expect "rejects a prefix with spaces" 2 "DRILL_S3_PREFIX may only contain"

run "BACKUP_ARCHIVE_PASSWORD=${PASSWORD}" "DRILL_ARCHIVE=${SANDBOX}/good.zip" --
if [ "${CODE}" -eq 0 ] && [[ "${OUT}" == *"units issued: 3, hooks: 3, hooks with an unknown status: 0"* ]] &&
  [[ "${OUT}" == *"bytes, encrypted), 1 other files"* ]] && [[ "${OUT}" == *"RESULT: restore drill passed"* ]] &&
  [[ "${OUT}" == *"cleanup: removed container"* ]]; then
  ok "restores a good archive, checks the invariants and removes its container"
else
  not_ok "restores a good archive, checks the invariants and removes its container" "exit ${CODE}, output: ${OUT}"
fi

run "BACKUP_ARCHIVE_PASSWORD=${PASSWORD}" "DRILL_ARCHIVE=${SANDBOX}/extra-hook.zip" --
expect_failed_check "fails when the hook count differs from the issued units" "hook count 4 differs from the issued units 3"

run "BACKUP_ARCHIVE_PASSWORD=${PASSWORD}" "DRILL_ARCHIVE=${SANDBOX}/unknown-status.zip" --
expect_failed_check "fails on a hook with an unknown status" "1 hooks have a status outside"

run "BACKUP_ARCHIVE_PASSWORD=wrong${PASSWORD}" "DRILL_ARCHIVE=${SANDBOX}/good.zip" --
expect_failed_check "fails with a wrong password" "decrypting or restoring the dump failed"

run "BACKUP_ARCHIVE_PASSWORD=${PASSWORD}" "DRILL_ARCHIVE=${SANDBOX}/plain.zip" --
expect_failed_check "refuses an archive whose dump is not encrypted" "the dump entry is not encrypted"

EXPECTED_MC_HOST="https://${RESTORE_KEY_ID}:rs%2F${STAMP}%2Bx$$@s3.example.test"
run "${S3_ENV[@]}" "DRILL_S3_ENDPOINT=https://s3.example.test/" "PATH=${STUBS}:${PATH}" "REAL_DOCKER=${REAL_DOCKER}" \
  "STUB_MC_IMAGE=${MC_IMAGE}" "STUB_LOG=${STUB_LOG}" "STUB_ARCHIVE=${SANDBOX}/good.zip" \
  "STUB_EXPECT_MC_HOST=${EXPECTED_MC_HOST}" --
MC_CALLS="$(cat "${STUB_LOG}" 2>/dev/null || true)"
if [ "${CODE}" -eq 0 ] && [[ "${OUT}" == *"source: s3://askida-backups/askida/2026-10-03-03-30-00.zip (3 archives listed)"* ]] &&
  [[ "${MC_CALLS}" == *"drill/askida-backups/askida/2026-10-03-03-30-00.zip"* ]] &&
  [ "$(grep -c '^mc_host=expected$' <<<"${MC_CALLS}")" -eq 2 ] && [[ "${MC_CALLS}" != *"${RESTORE_SECRET}"* ]] &&
  [[ "${MC_CALLS}" != *"${RESTORE_KEY_ID}"* ]] && [[ "${OUT}" == *"RESULT: restore drill passed"* ]]; then
  ok "bucket path takes the newest archive with the restore identity passed only through the environment"
else
  not_ok "bucket path takes the newest archive with the restore identity passed only through the environment" \
    "exit ${CODE}, output: ${OUT}, client calls: ${MC_CALLS}"
fi

if [[ "${ALL_OUTPUT}" != *"${PASSWORD}"* ]] && [[ "${ALL_OUTPUT}" != *"${RESTORE_SECRET}"* ]] &&
  [[ "${ALL_OUTPUT}" != *"${RESTORE_KEY_ID}"* ]]; then
  ok "no run printed the archive password or the restore credentials"
else
  not_ok "no run printed the archive password or the restore credentials"
fi

echo "${PASSED} passed, ${FAILED} failed"
[ "${FAILED}" -eq 0 ]
