# Shared helpers for backup.sh, restore.sh, restore-drill.sh, bucket-setup.sh and drill-e2e.sh.
# Sourced, never executed. POSIX sh: no arrays, no [[ ]], no pipefail (piped steps record their
# exit status in files instead).
#
# The helpers never print a credential. Bucket credentials reach the client only through the
# MC_HOST_<alias> environment variable of the client process, never as an argument.

# Git Bash on Windows must not rewrite container paths; no effect on Linux.
MSYS_NO_PATHCONV=1
MSYS2_ARG_CONV_EXCL='*'
export MSYS_NO_PATHCONV MSYS2_ARG_CONV_EXCL

# Default images: the ones of cetele/docker-compose.yml.
# Read by the scripts that source this file.
# shellcheck disable=SC2034
{
  CETELE_OPS_PG_IMAGE_DEFAULT="postgres:16.15-alpine"
  CETELE_OPS_MC_IMAGE_DEFAULT="pgsty/mc:RELEASE.2026-09-16T00-00-00Z"
  CETELE_OPS_MINIO_IMAGE_DEFAULT="pgsty/minio:RELEASE.2026-08-04T00-00-00Z"
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
  missing=""
  for name in "$@"; do
    eval "value=\${${name}:-}"
    # shellcheck disable=SC2154 # set by the eval above
    if [ -z "${value}" ]; then
      missing="${missing}${missing:+, }${name}"
    fi
  done
  value=""
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
  printf '%s' "$1" | grep -Eq '^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$' || die_config "bucket name is not valid: $1"
}

check_prefix() {
  printf '%s' "$1" | grep -Eq '^([A-Za-z0-9._-]+/)*$' || die_config "prefix must be empty or end with '/' and use letters, digits, '.', '_', '-': $1"
}

check_identifier() {
  printf '%s' "$2" | grep -Eq '^[a-z_][a-z0-9_]{0,62}$' || die_config "$1 is not a plain PostgreSQL identifier"
}

check_container_name() {
  printf '%s' "$2" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$' || die_config "$1 is not a container name"
}

# check_endpoint VAR VALUE NETWORK: https, or plain http only for local addresses or a name
# that resolves on the given docker network.
check_endpoint() {
  case "$2" in
    https://*) ;;
    http://localhost* | http://127.0.0.1* | http://host.docker.internal*) ;;
    http://*) [ -n "$3" ] || die_config "$1 must use https (plain http only for local addresses or a name on the docker network)" ;;
    *) die_config "$1 must be an http(s) URL" ;;
  esac
}

# mc_run ALIAS ENDPOINT ACCESS_KEY SECRET_KEY IMAGE NETWORK -- mc arguments...
# IMAGE empty: `mc` on PATH. Stdin and stdout pass through.
mc_run() {
  mc_alias="$1"
  mc_endpoint="${2%/}"
  mc_url="${mc_endpoint%%://*}://$3:$4@${mc_endpoint#*://}"
  mc_image="$5"
  mc_network="$6"
  shift 7
  if [ -z "${mc_image}" ]; then
    env "MC_HOST_${mc_alias}=${mc_url}" mc --quiet "$@"
  elif [ -n "${mc_network}" ]; then
    env "MC_HOST_${mc_alias}=${mc_url}" docker run --rm -i --network "${mc_network}" -e "MC_HOST_${mc_alias}" "${mc_image}" --quiet "$@"
  else
    env "MC_HOST_${mc_alias}=${mc_url}" docker run --rm -i -e "MC_HOST_${mc_alias}" "${mc_image}" --quiet "$@"
  fi
}

# pg_tool CONTAINER USER DATABASE TOOL [args...]: runs a PostgreSQL client tool either inside the
# named container (docker exec, local socket) or, with CONTAINER empty, from PATH with the libpq
# environment (PGHOST, PGPORT, PGUSER, PGPASSWORD or PGPASSFILE) and the given database.
pg_tool() {
  pg_container="$1"
  pg_user="$2"
  pg_database="$3"
  pg_bin="$4"
  shift 4
  if [ -n "${pg_container}" ]; then
    docker exec -i "${pg_container}" "${pg_bin}" -U "${pg_user}" -d "${pg_database}" "$@"
  else
    "${pg_bin}" -d "${pg_database}" "$@"
  fi
}

# psql_at CONTAINER USER DATABASE [psql args...]: unaligned, tuples only, stop on error.
psql_at() {
  psql_container="$1"
  psql_user="$2"
  psql_database="$3"
  shift 3
  pg_tool "${psql_container}" "${psql_user}" "${psql_database}" psql -X -q -At -v ON_ERROR_STOP=1 "$@"
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

# read_status FILE: the exit status a piped step wrote, or 1 when it wrote nothing.
read_status() {
  if [ -s "$1" ]; then
    tr -d ' \r\n' <"$1"
  else
    echo 1
  fi
}
