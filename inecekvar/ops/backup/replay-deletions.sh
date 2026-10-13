#!/usr/bin/env bash
# Replay account deletion requests recorded after a dump onto the restored database (security
# checklist items 20 and 21, docs/ops/backup-restore.md "Deleted accounts and restores").
#
# A restore brings back every account as of the dump. A deletion request made after the dump is
# not in it: without a replay the account would come back active, with its traces and favorites.
# Run this after restore.sh and before the API or the worker start.
#
#   1. read the request list: one "<account id> <requested at, UTC ISO 8601>" line per request
#      made at or after the dump time (the timestamp in the dump name); the runbook lists the
#      sources (the old primary's deletion_requests, or the API log event
#      auth.account.delete_requested)
#   2. per account: absent (not in the dump: nothing to erase), carried (the dump already holds
#      the request and its effects) or missing
#   3. with INECEKVAR_REPLAY_APPLY=1, re-apply each missing request with replay-deletion.sql and
#      check the effects again (replayed, or unverified when they are still not all present);
#      without it, missing requests are only reported and the script fails
#   4. report the scheduled requests already due: the next hourly deletion.hard_delete run
#      erases them (review them first, the runbook explains why)
#
# Usage: ops/backup/replay-deletions.sh [--help]
#
# Required environment:
#   INECEKVAR_REPLAY_DELETIONS_FILE   the request list (may be empty: nothing to replay)
#   INECEKVAR_RESTORE_PG_DATABASE     the restored database
# Target, one of:
#   INECEKVAR_RESTORE_PG_CONTAINER    container running the restored database (docker exec)
#   (unset)                           psql on PATH with the libpq environment
# Optional:
#   INECEKVAR_RESTORE_PG_USER         default inecekvar (container mode)
#   INECEKVAR_REPLAY_APPLY            1 re-applies missing requests; anything else reports only
#   INECEKVAR_REPLAY_STATE_FILE       file to receive the "<account id> <state>" lines
#
# Account ids are printed (they are the subject of the procedure); no email or other personal
# data is read or printed. Exit codes: 0 every request is carried, replayed or absent, 1 a request
# is missing or unverified, 2 usage or configuration error.
set -euo pipefail
set +x
umask 077

ops_name="replay-deletions"
script_dir="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
# shellcheck source=lib.sh
. "${script_dir}/lib.sh"

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

require_env INECEKVAR_REPLAY_DELETIONS_FILE INECEKVAR_RESTORE_PG_DATABASE
list="${INECEKVAR_REPLAY_DELETIONS_FILE}"
pg_container="${INECEKVAR_RESTORE_PG_CONTAINER:-}"
pg_database="${INECEKVAR_RESTORE_PG_DATABASE}"
pg_user="${INECEKVAR_RESTORE_PG_USER:-inecekvar}"
apply="${INECEKVAR_REPLAY_APPLY:-0}"
state_file="${INECEKVAR_REPLAY_STATE_FILE:-/dev/null}"

[ -f "${list}" ] || die_config "INECEKVAR_REPLAY_DELETIONS_FILE is not a file"
check_identifier INECEKVAR_RESTORE_PG_DATABASE "${pg_database}"
check_identifier INECEKVAR_RESTORE_PG_USER "${pg_user}"
uuid_re='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
time_re='^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:?[0-9]{2})$'
line_no=0
while read -r uid requested extra || [ -n "${uid:-}" ]; do
  line_no=$((line_no + 1))
  [ -n "${uid:-}" ] || continue
  [[ "${uid}" =~ ${uuid_re} ]] || die_config "line ${line_no}: not a lowercase account id"
  [[ "${requested:-}" =~ ${time_re} ]] || die_config "line ${line_no}: not an ISO 8601 UTC time"
  [ -z "${extra:-}" ] || die_config "line ${line_no}: expected two fields"
done < <(tr -d '\r' <"${list}")
if [ -n "${pg_container}" ]; then
  check_container_name INECEKVAR_RESTORE_PG_CONTAINER "${pg_container}"
  require_tool docker
else
  require_tool psql
fi

state_of() {
  psql_at "${pg_container}" "${pg_user}" "${pg_database}" -v "uid=$1" <"${script_dir}/deletion-state.sql"
}

: >"${state_file}"
missing=0
total=0
echo "== deletion requests after the dump (apply: ${apply})"
while read -r uid requested _; do
  [ -n "${uid:-}" ] || continue
  total=$((total + 1))
  state="$(state_of "${uid}")" || fail "cannot read the state of ${uid}"
  case "${state}" in
    absent) result="absent" ;;
    present) result="carried" ;;
    missing)
      if [ "${apply}" = "1" ]; then
        psql_at "${pg_container}" "${pg_user}" "${pg_database}" -v "uid=${uid}" -v "requested_at=${requested}" \
          <"${script_dir}/replay-deletion.sql" >/dev/null || fail "replay of ${uid} failed"
        if [ "$(state_of "${uid}")" = "present" ]; then result="replayed"; else result="unverified"; fi
      else
        result="missing"
      fi
      ;;
    *) fail "unexpected state for ${uid}: ${state}" ;;
  esac
  case "${result}" in missing | unverified) missing=$((missing + 1)) ;; esac
  printf '%s %s\n' "${uid}" "${result}" | tee -a "${state_file}"
done < <(tr -d '\r' <"${list}")

due="$(psql_at "${pg_container}" "${pg_user}" "${pg_database}" -c \
  "SELECT count(*) FROM public.deletion_requests d JOIN public.users u ON u.id = d.user_id
   WHERE d.state = 'scheduled' AND d.scheduled_for <= now() AND u.deactivated_at IS NOT NULL;")"
echo "scheduled requests already due (next hourly deletion.hard_delete erases them): ${due}"

if [ "${missing}" -gt 0 ]; then
  fail "${missing} of ${total} deletion requests recorded after the dump are not applied in ${pg_database}; re-run with INECEKVAR_REPLAY_APPLY=1 before starting the API or the worker"
fi
echo "RESULT: ${total} deletion requests after the dump checked, none missing"
