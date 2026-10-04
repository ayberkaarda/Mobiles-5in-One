#!/usr/bin/env bash
# Runs the device flows (integration_test/e2e_flows_test.dart) on an Android
# emulator against a local compose stack started from askida/ with the e2e
# ports, for example:
#
#   ASKIDA_PG_PORT=55471 ASKIDA_REDIS_PORT=56471 ASKIDA_WEB_PORT=58471 \
#   ASKIDA_MINIO_PORT=59471 ASKIDA_MINIO_CONSOLE_PORT=59472 \
#   ASKIDA_MAIL_SMTP_PORT=51471 ASKIDA_MAIL_UI_PORT=58472 \
#   docker compose -p askida-e2e up -d
#
# server/.env needs, besides the .env.example defaults:
#   APP_URL=http://10.0.2.2:58471              (pay pages open in the WebView)
#   AWS_PUBLIC_ENDPOINT=http://10.0.2.2:59471  (presigned document uploads)
#
# The script migrates and seeds the stack, creates the moderator account the
# approvals act as (once), and while the tests run approves every pending
# shop whose name matches E2E_APPROVE_LIKE (default %Deneme%) with
# `php artisan shops:verify`, the way a moderator would. E2E_TEST picks the
# test file; extra arguments go to `flutter test`.
set -euo pipefail
cd "$(dirname "$0")/.."

project="${E2E_PROJECT:-askida-e2e}"
server="${project}-server-1"
postgres="${project}-postgres-1"
actor="${E2E_ACTOR:-e2e-moderator@example.test}"
device="${E2E_DEVICE:-emulator-5554}"
approve_like="${E2E_APPROVE_LIKE:-%Deneme%}"
test_file="${E2E_TEST:-integration_test/e2e_flows_test.dart}"

docker exec "$server" php artisan migrate --force --no-interaction >/dev/null
docker exec "$server" php artisan db:seed --force --no-interaction >/dev/null
known=$(docker exec "$postgres" psql -U askida -d askida -tAc \
  "select count(*) from users where email = '${actor}'")
if [ "$known" = "0" ]; then
  # The command prints a one-time password; it is not needed here.
  docker exec "$server" php artisan admin:create "$actor" --role=moderator >/dev/null
fi

approve_pending() {
  while true; do
    for slug in $(docker exec "$postgres" psql -U askida -d askida -tAc \
      "select slug from shops where verification_state = 'pending' and name like '${approve_like}'"); do
      docker exec "$server" php artisan shops:verify "$slug" --actor="$actor" || true
    done
    sleep 3
  done
}

approve_pending &
watcher=$!
trap 'kill "$watcher" 2>/dev/null || true' EXIT

flutter test "$test_file" --flavor dev -d "$device" "$@"
