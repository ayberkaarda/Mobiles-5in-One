# shellcheck shell=bash
# Sourced by backup.sh and restore.sh (docs/ops/backup-restore.md). Keeps the database password off every
# command line and out of the environment that pg_dump, pg_restore and psql inherit.
#
# pgpass_setup URL DIR
#   URL  optional postgresql:// (or postgres://) URI. Its parts become PGUSER, PGHOST, PGPORT, PGDATABASE and,
#        for an sslmode parameter, PGSSLMODE; user, password and database may be percent-encoded.
#   DIR  a private directory (mode 700, removed by the caller's EXIT trap) that receives the temporary pgpass file.
# The password from the URL, or else from PGPASSWORD, is written to DIR/pgpass (umask 077) and PGPASSFILE points
# at it; PGPASSWORD is unset. Without either, nothing is written and libpq uses PGPASSFILE, ~/.pgpass or a
# PGSERVICE entry as usual. Returns 1 on a URL it cannot read and 2 on an unsupported parameter; it never prints
# the URL or the password.

pgpass_decode() {
  local value="${1//\\/\\\\}"
  printf '%b' "${value//%/\\x}"
}

pgpass_escape() {
  local value="${1//\\/\\\\}"
  printf '%s' "${value//:/\\:}"
}

pgpass_setup() {
  local url="$1" dir="$2" password="" query="" param
  if [[ -n "${url}" ]]; then
    local pattern='^postgres(ql)?://(([^:@/?#]*)(:([^@/?#]*))?@)?(\[[^]/?#]+\]|[^:/?#]*)(:([0-9]+))?(/([^?#]*))?(\?([^#]*))?$'
    [[ "${url}" =~ ${pattern} ]] || return 1
    local user="${BASH_REMATCH[3]}" secret="${BASH_REMATCH[5]}" host="${BASH_REMATCH[6]}" port="${BASH_REMATCH[8]}"
    local name="${BASH_REMATCH[10]}"
    query="${BASH_REMATCH[12]}"
    if [[ -n "${user}" ]]; then
      PGUSER="$(pgpass_decode "${user}")"
      export PGUSER
    fi
    password="$(pgpass_decode "${secret}")"
    host="${host#[}"
    if [[ -n "${host}" ]]; then export PGHOST="${host%]}"; fi
    if [[ -n "${port}" ]]; then export PGPORT="${port}"; fi
    if [[ -n "${name}" ]]; then
      PGDATABASE="$(pgpass_decode "${name}")"
      export PGDATABASE
    fi
    if [[ -n "${query}" ]]; then
      local -a params
      IFS='&' read -r -a params <<<"${query}"
      for param in "${params[@]}"; do
        case "${param}" in
          sslmode=*) export PGSSLMODE="${param#sslmode=}" ;;
          *) return 2 ;;
        esac
      done
    fi
  fi
  if [[ -z "${password}" && -n "${PGPASSWORD:-}" ]]; then
    password="${PGPASSWORD}"
  fi
  unset PGPASSWORD
  if [[ -n "${password}" ]]; then
    [[ "${password}" != *$'\n'* ]] || return 1
    (umask 077 && printf '*:*:*:*:%s\n' "$(pgpass_escape "${password}")" > "${dir}/pgpass")
    export PGPASSFILE="${dir}/pgpass"
  fi
  return 0
}
