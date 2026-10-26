-- Restore smoke queries (docs/ops/backup-restore.md). Output: one name|value row per check, run with
-- psql -tA -F'|'. The drill takes the same rows from the source database and diffs them.
SELECT 'stations', count(*) FROM stations;
-- Spatial index and geography type survive the restore: stations within 2 km of Moda (sample seed point).
SELECT 'stations_within_2km_of_moda', count(*) FROM stations
  WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint(29.0265, 40.9806), 4326)::geography, 2000);
SELECT 'nearest_station_to_moda', coalesce((SELECT id::text FROM stations
  ORDER BY location <-> ST_SetSRID(ST_MakePoint(29.0265, 40.9806), 4326)::geography LIMIT 1), 'none');
SELECT 'station_geometry_md5', coalesce(md5(string_agg(id::text || ':' || ST_AsText(location::geometry), ',' ORDER BY id)), 'none')
  FROM stations;
SELECT 'feedings', count(*) FROM feedings;
SELECT 'urgent_posts', count(*) FROM urgent_posts;
SELECT 'users', count(*) FROM users;
SELECT 'totp_ciphertext_rows', count(*) FROM users WHERE totp_secret_enc IS NOT NULL;
SELECT 'districts', count(*) FROM districts;
SELECT 'migrations', count(*) FROM "__EFMigrationsHistory";
SELECT 'latest_migration', coalesce(max("MigrationId"), 'none') FROM "__EFMigrationsHistory";
SELECT 'postgis_version', extversion FROM pg_extension WHERE extname = 'postgis';
