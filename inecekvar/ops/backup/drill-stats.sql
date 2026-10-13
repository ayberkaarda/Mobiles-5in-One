-- Fingerprint of an Inecek Var database for the restore drill (docs/ops/backup-restore.md).
-- One read-only statement. Output, one line per row, sorted bytewise:
--   rows <table> <exact count>            for every table in schema public
--   hash <table> sha256=<hex>             content digest of the tables a restore must keep
--                                         exactly: line geometry and stop order, line state,
--                                         accounts (with a digest of the TOTP ciphertext),
--                                         deletion requests and traces
-- Each digest covers the listed columns of every row ordered by primary key, so any changed,
-- missing or extra row changes it.
WITH table_rows AS (
    SELECT tablename,
           (xpath('/row/c/text()',
                  query_to_xml(format('SELECT count(*) AS c FROM public.%I', tablename), false, true, '')))[1]::text AS row_count
    FROM pg_tables
    WHERE schemaname = 'public'
),
digests(tablename, body) AS (
    SELECT 'line_versions', string_agg(
               id::text || '|' || line_id::text || '|' || version_no::text || '|' || encode(ST_AsEWKB(geom), 'hex')
               || '|' || stop_ids::text || '|' || COALESCE(fare_minor::text, '-'),
               ',' ORDER BY id)
    FROM public.line_versions
    UNION ALL
    SELECT 'line_stops', string_agg(line_version_id::text || '|' || seq::text || '|' || stop_id::text, ','
               ORDER BY line_version_id, seq)
    FROM public.line_stops
    UNION ALL
    SELECT 'lines', string_agg(id::text || '|' || status || '|' || COALESCE(current_version_id::text, '-'), ','
               ORDER BY id)
    FROM public.lines
    UNION ALL
    SELECT 'stops', string_agg(id::text || '|' || encode(ST_AsEWKB(location::geometry), 'hex'), ',' ORDER BY id)
    FROM public.stops
    UNION ALL
    SELECT 'users', string_agg(
               id::text || '|' || email || '|' || role || '|' || COALESCE(deactivated_at::text, '-') || '|'
               || COALESCE(encode(sha256(totp_secret_enc), 'hex'), '-'),
               ',' ORDER BY id)
    FROM public.users
    UNION ALL
    SELECT 'deletion_requests', string_agg(
               id::text || '|' || user_id::text || '|' || state || '|' || scheduled_for::text, ',' ORDER BY id)
    FROM public.deletion_requests
    UNION ALL
    SELECT 'traces', string_agg(id::text || '|' || author_id::text || '|' || md5(points::text), ',' ORDER BY id)
    FROM public.traces
),
lines AS (
    SELECT 'rows ' || tablename || ' ' || row_count AS line FROM table_rows
    UNION ALL
    SELECT 'hash ' || tablename || ' sha256=' || encode(sha256(convert_to(COALESCE(body, ''), 'UTF8')), 'hex')
    FROM digests
)
SELECT line FROM lines ORDER BY line COLLATE "C"
