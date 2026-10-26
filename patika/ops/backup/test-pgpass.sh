#!/usr/bin/env bash
# Unit checks for pgpass.sh: URL parsing, percent-decoding, pgpass escaping, PGPASSWORD removal and rejection of
# URLs the scripts cannot read. Runs anywhere bash runs; prints "pgpass: all checks passed".
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=pgpass.sh
. "${here}/pgpass.sh"

failures=0
check() {
  if [[ "$2" == "$3" ]]; then printf 'ok   %s\n' "$1"; else printf 'FAIL %s: expected [%s], got [%s]\n' "$1" "$3" "$2"; failures=$((failures + 1)); fi
}

run() (
  # A fresh subshell per case: the variables pgpass_setup exports never leak between cases.
  unset PGUSER PGHOST PGPORT PGDATABASE PGSSLMODE PGPASSFILE PGPASSWORD
  dir="$(mktemp -d)"
  trap 'rm -rf "${dir}"' EXIT
  if [[ -n "${2:-}" ]]; then export PGPASSWORD="$2"; fi
  status=0
  pgpass_setup "$1" "${dir}" || status=$?
  printf '%s|%s|%s|%s|%s|%s|%s|' "${status}" "${PGUSER:-}" "${PGHOST:-}" "${PGPORT:-}" "${PGDATABASE:-}" "${PGSSLMODE:-}" "${PGPASSWORD:-unset}"
  if [[ -n "${PGPASSFILE:-}" ]]; then
    printf '%s|%s' "$(stat -c '%a' "${PGPASSFILE}")" "$(cat "${PGPASSFILE}")"
  fi
)

check "plain url" "$(run 'postgresql://patika:s3cret@db.internal:6432/patika')" "0|patika|db.internal|6432|patika||unset|600|*:*:*:*:s3cret"
check "percent-encoded parts" "$(run 'postgres://app%2Buser:p%40ss%3Aw%5Cd@db/my%20db?sslmode=require')" \
  '0|app+user|db||my db|require|unset|600|*:*:*:*:p@ss\:w\\d'
check "ipv6 host" "$(run 'postgresql://u:p@[2001:db8::5]:5433/d')" "0|u|2001:db8::5|5433|d||unset|600|*:*:*:*:p"
check "no password in url, PGPASSWORD moved" "$(run 'postgresql://u@h/d' 'from-env')" "0|u|h||d||unset|600|*:*:*:*:from-env"
check "url password wins over PGPASSWORD" "$(run 'postgresql://u:url@h/d' 'from-env')" "0|u|h||d||unset|600|*:*:*:*:url"
check "no url, no password" "$(run '')" "0||||||unset|"
check "no url, PGPASSWORD only" "$(run '' 'only-env')" "0||||||unset|600|*:*:*:*:only-env"
check "not a postgres url" "$(run 'mysql://u:p@h/d')" "1||||||unset|"
check "unsupported parameter" "$(run 'postgresql://u:p@h/d?options=-c%20x')" "2|u|h||d||unset|"

if [[ "${failures}" -ne 0 ]]; then
  printf 'pgpass: %s checks failed\n' "${failures}"
  exit 1
fi
printf 'pgpass: all checks passed\n'
