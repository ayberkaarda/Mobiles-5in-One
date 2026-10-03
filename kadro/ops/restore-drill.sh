#!/usr/bin/env bash
# Backup and restore drill against two scratch PostGIS containers.
#
#   1. start scratch container A and seed it (PostGIS extension, sample tables, geometry rows)
#   2. pg_dump -Fc from A
#   3. start a second, fresh scratch container B and pg_restore the dump into a new database
#   4. compare per-table row counts (A vs B) and check the PostGIS extension and a spatial query in B
#   5. remove both containers by exact name (also on failure or interrupt)
#
# Only containers created by this script are touched, and only with `docker rm -f <exact name>`.
# No volumes are created (data lives in the container filesystem), no compose, no prune.
#
# Optional environment:
#   DRILL_IMAGE     image to use (default: the image of docker-compose.yml)
#   DRILL_SEED_SQL  path to an extra SQL file applied to A after the built-in seed
set -euo pipefail

# Prevent Git Bash on Windows from rewriting container paths such as /tmp.
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL='*'

IMAGE="${DRILL_IMAGE:-postgis/postgis:16-3.5-alpine}"
RUN_ID="$(date +%s)-$$"
SRC="kadro-drill-src-${RUN_ID}"
DST="kadro-drill-dst-${RUN_ID}"
DB="drill"
PGUSER_NAME="drill"
# Throwaway password for containers that are never published on a host port.
PGPASS_VALUE="drill-scratch-password"

cleanup() {
  status=$?
  docker rm -f "${SRC}" >/dev/null 2>&1 || true
  docker rm -f "${DST}" >/dev/null 2>&1 || true
  echo "cleanup: removed containers ${SRC} and ${DST}"
  exit "${status}"
}
trap cleanup EXIT INT TERM

start_container() {
  docker run -d --name "$1" \
    -e POSTGRES_USER="${PGUSER_NAME}" -e POSTGRES_PASSWORD="${PGPASS_VALUE}" -e POSTGRES_DB="${DB}" \
    "${IMAGE}" >/dev/null
}

# During first-boot initialisation the server listens on the unix socket only, so a TCP check
# succeeds only once the final server is up.
wait_ready() {
  for _ in $(seq 1 60); do
    if docker exec "$1" pg_isready -h 127.0.0.1 -U "${PGUSER_NAME}" -d "${DB}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "container $1 did not become ready" >&2
  return 1
}

# psql_in <container> [psql args...]  (SQL on stdin or via -c); TARGET_DB overrides the database.
psql_in() {
  local c="$1"
  shift
  docker exec -i "$c" psql -X -q -v ON_ERROR_STOP=1 -U "${PGUSER_NAME}" -d "${TARGET_DB:-${DB}}" "$@"
}

# One line per table: "<schema>.<table> <exact row count>", sorted. Exact counts, not estimates.
row_counts() {
  psql_in "$1" -At -F ' ' -c "
    SELECT format('%I.%I', schemaname, tablename),
           (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', schemaname, tablename), false, true, '')))[1]::text
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename <> 'spatial_ref_sys'
    ORDER BY 1;"
}

echo "image: ${IMAGE}"
echo "== step 1: start and seed source ${SRC}"
start_container "${SRC}"
wait_ready "${SRC}"
psql_in "${SRC}" <<'SQL'
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE TABLE drill_users (id serial PRIMARY KEY, email text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE drill_venues (id serial PRIMARY KEY, name text NOT NULL, location geometry(Point, 4326) NOT NULL);
CREATE INDEX drill_venues_location_idx ON drill_venues USING gist (location);
INSERT INTO drill_users (email) SELECT 'user' || g || '@example.test' FROM generate_series(1, 250) g;
INSERT INTO drill_venues (name, location)
  SELECT 'Venue ' || g, ST_SetSRID(ST_MakePoint(28.9 + g * 0.001, 41.0 + g * 0.001), 4326)
  FROM generate_series(1, 120) g;
SQL
if [ -n "${DRILL_SEED_SQL:-}" ]; then
  echo "applying extra seed: ${DRILL_SEED_SQL}"
  psql_in "${SRC}" <"${DRILL_SEED_SQL}"
fi
row_counts "${SRC}" >"${TMPDIR:-/tmp}/drill-src-counts-${RUN_ID}.txt"
echo "source row counts:"
cat "${TMPDIR:-/tmp}/drill-src-counts-${RUN_ID}.txt"

echo "== step 2: pg_dump -Fc from source"
DUMP_HOST="${TMPDIR:-/tmp}/drill-${RUN_ID}.dump"
# Stream through stdout so no container path has to be translated on Windows hosts.
docker exec "${SRC}" pg_dump -Fc -U "${PGUSER_NAME}" -d "${DB}" >"${DUMP_HOST}"
echo "dump size: $(wc -c <"${DUMP_HOST}") bytes"

echo "== step 3: start fresh target ${DST} and restore"
start_container "${DST}"
wait_ready "${DST}"
# The image preinstalls PostGIS helper schemas in its default database, so restore into a brand
# new database created from template0 (this is also how a real restore starts).
RESTORED_DB="restored"
docker exec "${DST}" psql -X -q -v ON_ERROR_STOP=1 -U "${PGUSER_NAME}" -d "${DB}" -c "CREATE DATABASE ${RESTORED_DB} TEMPLATE template0;"
docker exec -i "${DST}" pg_restore -U "${PGUSER_NAME}" -d "${RESTORED_DB}" --no-owner --exit-on-error <"${DUMP_HOST}"
rm -f "${DUMP_HOST}"

echo "== step 4: verify"
TARGET_DB="${RESTORED_DB}" row_counts "${DST}" >"${TMPDIR:-/tmp}/drill-dst-counts-${RUN_ID}.txt"
echo "restored row counts:"
cat "${TMPDIR:-/tmp}/drill-dst-counts-${RUN_ID}.txt"
if ! diff "${TMPDIR:-/tmp}/drill-src-counts-${RUN_ID}.txt" "${TMPDIR:-/tmp}/drill-dst-counts-${RUN_ID}.txt"; then
  echo "FAIL: row counts differ between source and restored database" >&2
  exit 1
fi
echo "row counts: identical"

POSTGIS_VERSION="$(TARGET_DB="${RESTORED_DB}" psql_in "${DST}" -At -c "SELECT extversion FROM pg_extension WHERE extname = 'postgis';")"
if [ -z "${POSTGIS_VERSION}" ]; then
  echo "FAIL: postgis extension missing in restored database" >&2
  exit 1
fi
echo "postgis extension in restored database: ${POSTGIS_VERSION}"

NEAR="$(TARGET_DB="${RESTORED_DB}" psql_in "${DST}" -At -c "SELECT count(*) FROM drill_venues WHERE ST_DWithin(location::geography, ST_SetSRID(ST_MakePoint(28.9, 41.0), 4326)::geography, 20000);")"
echo "spatial query (venues within 20 km of the origin): ${NEAR}"
if [ "${NEAR}" != "120" ]; then
  echo "FAIL: spatial query returned ${NEAR}, expected 120" >&2
  exit 1
fi

rm -f "${TMPDIR:-/tmp}/drill-src-counts-${RUN_ID}.txt" "${TMPDIR:-/tmp}/drill-dst-counts-${RUN_ID}.txt"
echo "RESULT: restore drill passed"
