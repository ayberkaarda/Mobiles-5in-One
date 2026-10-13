# shellcheck shell=bash
# Shared helpers of backup.sh, bucket-setup.sh, restore.sh, restore-drill.sh, replay-deletions.sh
# and drill-e2e.sh (security checklist item 20, docs/ops/backup-restore.md). Sourced by bash,
# never executed.
#
# The helpers never print a credential. Bucket credentials reach the client only through the
# MC_HOST_<alias> environment variable of the client process, never as an argument.
#
# The check_* functions at the end are the restore checks. Each one records one row per rule in
# the check table (check_record) and returns 1 when a rule fails, so a caller can run them all
# and print the whole table before failing. checks.test.sh runs them on fixtures.

# Git Bash on Windows must not rewrite container paths; no effect on Linux.
MSYS_NO_PATHCONV=1
MSYS2_ARG_CONV_EXCL='*'
export MSYS_NO_PATHCONV MSYS2_ARG_CONV_EXCL

# Default images: the ones of inecekvar/docker-compose.yml. Read by the scripts that source this.
# shellcheck disable=SC2034
{
  INECEKVAR_OPS_PG_IMAGE_DEFAULT="postgis/postgis:16-3.5"
  INECEKVAR_OPS_MC_IMAGE_DEFAULT="pgsty/mc:RELEASE.2026-09-16T00-00-00Z"
  INECEKVAR_OPS_MINIO_IMAGE_DEFAULT="pgsty/minio:RELEASE.2026-08-04T00-00-00Z"
  INECEKVAR_OPS_BUCKET_DEFAULT="inecekvar-backups"
  INECEKVAR_OPS_PREFIX_DEFAULT="inecekvar/"
  # Dump object names: <prefix>inecekvar-<UTC YYYYMMDDTHHMMSSZ>.dump.age, so names sort by time.
  INECEKVAR_OPS_DUMP_RE='inecekvar-[0-9]{8}T[0-9]{6}Z\.dump\.age'
}

# ops_name is set by each script before sourcing (backup, restore, restore-drill, ...).
die_config() {
  echo "${ops_name:-ops}: $*" >&2
  exit 2
}

fail() {
  echo "${ops_name:-ops}: FAIL $*" >&2
  exit 1
}

# require_env NAME...: refuses to run when one of the variables is empty, naming all of them.
require_env() {
  local name missing=""
  for name in "$@"; do
    if [ -z "${!name:-}" ]; then
      missing="${missing}${missing:+, }${name}"
    fi
  done
  [ -z "${missing}" ] || die_config "refusing to run, missing environment: ${missing}"
}

require_tool() {
  command -v "$1" >/dev/null 2>&1 || die_config "required tool not found: $1"
}

# A credential travels inside a URL (MC_HOST_<alias>), so only URL-safe characters are accepted.
# Generate keys with `openssl rand -hex 24` or the provider console (letters and digits).
check_url_safe() {
  case "$2" in
    "" | *[!A-Za-z0-9._~-]*) die_config "$1 may only contain letters, digits, '.', '_', '~' and '-'" ;;
  esac
}

check_bucket() {
  [[ "$1" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]] || die_config "bucket name is not valid: $1"
}

check_prefix() {
  [[ "$1" =~ ^([A-Za-z0-9._-]+/)*$ ]] ||
    die_config "prefix must be empty or end with '/' and use letters, digits, '.', '_', '-': $1"
}

check_identifier() {
  [[ "$2" =~ ^[a-z_][a-z0-9_]{0,62}$ ]] || die_config "$1 is not a plain PostgreSQL identifier"
}

check_container_name() {
  [[ "$2" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$ ]] || die_config "$1 is not a container name"
}

# check_endpoint VAR VALUE NETWORK: https, or plain http only for exact local hosts or a
# single-label name that resolves on the given docker network.
check_endpoint() {
  local authority host port
  case "$2" in
    *@*) die_config "$1 must not contain user info" ;;
  esac
  authority="${2#*://}"
  authority="${authority%%/*}"
  case "${authority}" in
    \[*\]*)
      host="${authority%%]*}]"
      port="${authority#*]}"
      ;;
    *)
      host="${authority%%:*}"
      port="${authority#"${host}"}"
      ;;
  esac
  [ -n "${host}" ] || die_config "$1 must have a host"
  if [ "${host}" != '[::1]' ] && ! [[ "${host}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]]; then
    die_config "$1 has an invalid host"
  fi
  case "${port}" in
    "") ;;
    :*)
      port="${port#:}"
      case "${port}" in
        "" | *[!0-9]*) die_config "$1 has an invalid port" ;;
      esac
      ;;
    *) die_config "$1 has an invalid authority" ;;
  esac
  case "$2" in
    https://*) ;;
    http://*)
      case "${host}" in
        localhost | 127.0.0.1 | '[::1]' | host.docker.internal) ;;
        *)
          if [ -z "$3" ] || ! [[ "${host}" =~ ^[A-Za-z0-9][A-Za-z0-9_-]*$ ]]; then
            die_config "$1 must use https (plain http only for exact local hosts or single-label docker names)"
          fi
          ;;
      esac
      ;;
    *) die_config "$1 must be an http(s) URL" ;;
  esac
}

# mc_run ALIAS ENDPOINT ACCESS_KEY SECRET_KEY IMAGE NETWORK -- mc arguments...
# IMAGE empty: `mc` on PATH. Stdin and stdout pass through.
mc_run() {
  local alias="$1" endpoint="${2%/}" image="$5" network="$6" url
  url="${endpoint%%://*}://$3:$4@${endpoint#*://}"
  shift 7
  if [ -z "${image}" ]; then
    env "MC_HOST_${alias}=${url}" mc --quiet "$@"
  elif [ -n "${network}" ]; then
    env "MC_HOST_${alias}=${url}" docker run --rm -i --network "${network}" -e "MC_HOST_${alias}" "${image}" --quiet "$@"
  else
    env "MC_HOST_${alias}=${url}" docker run --rm -i -e "MC_HOST_${alias}" "${image}" --quiet "$@"
  fi
}

# pg_tool CONTAINER USER DATABASE TOOL [args...]: a PostgreSQL client tool inside the named
# container (docker exec, local socket) or, with CONTAINER empty, from PATH with the libpq
# environment (PGHOST, PGPORT, PGUSER, PGPASSFILE or PGPASSWORD) and the given database.
pg_tool() {
  local container="$1" user="$2" database="$3" bin="$4"
  shift 4
  if [ -n "${container}" ]; then
    docker exec -i "${container}" "${bin}" -U "${user}" -d "${database}" "$@"
  else
    "${bin}" -d "${database}" "$@"
  fi
}

# psql_at CONTAINER USER DATABASE [psql args...]: unaligned, tuples only, stop on error.
psql_at() {
  local container="$1" user="$2" database="$3"
  shift 3
  pg_tool "${container}" "${user}" "${database}" psql -X -q -At -v ON_ERROR_STOP=1 "$@"
}

# native_path PATH: the path as a native Windows program (age.exe) understands it under Git Bash,
# where path conversion is switched off above; unchanged elsewhere.
native_path() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -m "$1"
  else
    printf '%s\n' "$1"
  fi
}

# random_hex BYTES: lowercase hex from /dev/urandom (Linux and Git Bash).
random_hex() {
  od -An -tx1 -N"$1" /dev/urandom | tr -d ' \n'
}

file_size() {
  wc -c <"$1" | tr -d ' '
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d ' ' -f 1
  else
    shasum -a 256 "$1" | cut -d ' ' -f 1
  fi
}

# newest_dump_key FILE: the newest dump name in an `mc ls --json` listing (names sort by time);
# empty output when the listing holds no dump.
newest_dump_key() {
  { grep -Eo "\"key\":\"${INECEKVAR_OPS_DUMP_RE}\"" "$1" || true; } |
    sed -e 's/^"key":"//' -e 's/"$//' | LC_ALL=C sort | tail -n 1
}

# dump_stamp_iso KEY: the UTC time in a dump name as YYYY-MM-DDTHH:MM:SSZ (the time backup.sh
# started, never later than the pg_dump snapshot).
dump_stamp_iso() {
  local stamp
  stamp="$(printf '%s' "${1##*/}" | sed -n 's/^inecekvar-\([0-9]\{8\}T[0-9]\{6\}Z\)\.dump\.age$/\1/p')"
  [ -n "${stamp}" ] || return 1
  printf '%s-%s-%sT%s:%s:%sZ\n' "${stamp:0:4}" "${stamp:4:2}" "${stamp:6:2}" "${stamp:9:2}" "${stamp:11:2}" "${stamp:13:2}"
}

# alembic_head_of DIR: the single head revision of the Alembic scripts in DIR (the revision no
# other script names as down_revision). Fails when there is no head or more than one.
alembic_head_of() {
  local revisions downs heads
  revisions="$(sed -n 's/^revision[^=]*= *"\([^"]*\)".*/\1/p' "$1"/*.py | LC_ALL=C sort -u)"
  downs="$(sed -n 's/^down_revision[^=]*= *"\([^"]*\)".*/\1/p' "$1"/*.py | LC_ALL=C sort -u)"
  [ -n "${revisions}" ] || return 1
  heads="$(LC_ALL=C comm -23 <(printf '%s\n' "${revisions}") <(printf '%s\n' "${downs}"))"
  [ "$(printf '%s\n' "${heads}" | grep -c .)" = "1" ] || return 1
  printf '%s\n' "${heads}"
}

# ---- check table ----------------------------------------------------------------------------
# check_table is a file path set by the caller (mktemp); rows are "<name>\t<result>\t<detail>",
# result pass, FAIL or skip (not exercised in this run: printed, never counted as a pass).

check_record() {
  printf '%s\t%s\t%s\n' "$1" "$2" "$3" >>"${check_table:?check_table is not set}"
}

check_print_table() {
  printf '%-42s %-6s %s\n' "CHECK" "RESULT" "DETAIL"
  awk -F '\t' '{ printf "%-42s %-6s %s\n", $1, $2, $3 }' "${check_table}"
}

check_failures() {
  awk -F '\t' '$2 == "FAIL" { n++ } END { print n + 0 }' "${check_table}"
}

# check_alembic_head EXPECTED ACTUAL: ACTUAL is the content of alembic_version (one row per
# line); exactly one row equal to EXPECTED passes.
check_alembic_head() {
  local rows
  rows="$(printf '%s\n' "$2" | grep -c . || true)"
  if [ -n "$1" ] && [ "${rows}" = "1" ] && [ "$2" = "$1" ]; then
    check_record alembic_head pass "restored $2 = repository head $1"
    return 0
  fi
  check_record alembic_head FAIL "restored '$(printf '%s' "$2" | tr '\n' ' ')' (${rows} rows), repository head '$1'"
  return 1
}

# check_rules FILE RULE...: FILE holds "<rule> <violations>" lines; every named rule must be
# present exactly once with 0 violations. A missing, repeated or extra rule fails, so an empty or
# truncated result can never pass.
check_rules() {
  local file="$1" rule count lines status=0
  shift
  for rule in "$@"; do
    lines="$(grep -c "^${rule} " "${file}" || true)"
    count="$(sed -n "s/^${rule} \([0-9][0-9]*\)$/\1/p" "${file}")"
    if [ "${lines}" != "1" ] || [ -z "${count}" ]; then
      check_record "${rule}" FAIL "no single result line (found ${lines})"
      status=1
    elif [ "${count}" = "0" ]; then
      check_record "${rule}" pass "0 violations"
    else
      check_record "${rule}" FAIL "${count} violations"
      status=1
    fi
  done
  while IFS=' ' read -r rule _; do
    [ -n "${rule}" ] || continue
    case " $* " in
      *" ${rule} "*) ;;
      *)
        check_record "${rule}" FAIL "unexpected rule in the result"
        status=1
        ;;
    esac
  done <"${file}"
  return "${status}"
}

# check_required_tables STATS_FILE TABLE...: STATS_FILE holds "rows <table> <count>" lines
# (drill-stats.sql); every named table must be listed with at least one row.
check_required_tables() {
  local file="$1" table count status=0 empty="" ok=0
  shift
  [ "$#" -gt 0 ] || {
    check_record required_tables_not_empty FAIL "no table named"
    return 1
  }
  for table in "$@"; do
    count="$(sed -n "s/^rows ${table} \([0-9][0-9]*\)$/\1/p" "${file}")"
    if [ -z "${count}" ] || [ "${count}" = "0" ]; then
      empty="${empty}${empty:+, }${table}(${count:-missing})"
      status=1
    else
      ok=$((ok + 1))
    fi
  done
  if [ "${status}" = "0" ]; then
    check_record required_tables_not_empty pass "${ok} tables hold rows"
  else
    check_record required_tables_not_empty FAIL "empty or missing: ${empty}"
  fi
  return "${status}"
}

# check_fingerprint EXPECTED_FILE ACTUAL_FILE: line-by-line equality of two drill-stats.sql
# outputs (row counts and content hashes). An empty expected file fails.
check_fingerprint() {
  local differences lines
  if [ ! -s "$1" ]; then
    check_record fingerprint_matches_source FAIL "no source fingerprint"
    return 1
  fi
  lines="$(grep -c . "$1" || true)"
  differences="$(diff <(tr -d '\r' <"$1") <(tr -d '\r' <"$2") | grep -c '^[<>]' || true)"
  if [ "${differences}" = "0" ]; then
    check_record fingerprint_matches_source pass "${lines} lines identical (row counts and hashes)"
    return 0
  fi
  check_record fingerprint_matches_source FAIL "${differences} differing lines of ${lines}"
  return 1
}

# check_deletion_replay FILE: FILE holds "<user id> <state>" lines from the replay step, state
# one of: carried (already in the dump), replayed (re-applied and verified), absent (no such
# account in the dump, nothing to erase), missing (recorded after the dump, not re-applied) or
# unverified (re-applied but the immediate effects are not all present).
check_deletion_replay() {
  local carried replayed absent bad
  carried="$(grep -c ' carried$' "$1" || true)"
  replayed="$(grep -c ' replayed$' "$1" || true)"
  absent="$(grep -c ' absent$' "$1" || true)"
  bad="$(grep -cv ' \(carried\|replayed\|absent\)$' "$1" || true)"
  if [ "${bad}" = "0" ]; then
    check_record deletions_after_dump_reapplied pass "replayed ${replayed}, carried ${carried}, absent ${absent}"
    return 0
  fi
  check_record deletions_after_dump_reapplied FAIL "${bad} not re-applied: $(grep -v ' \(carried\|replayed\|absent\)$' "$1" | tr '\n' ' ')"
  return 1
}
