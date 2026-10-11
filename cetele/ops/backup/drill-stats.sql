-- Fingerprint of a Cetele database for the restore drill (docs/ops/backup-restore.md).
-- One statement, read-only, so psql (restore-drill.sh) and JDBC (BackupRestoreDrillTest) run the
-- same text. Output, one line per row, sorted bytewise:
--   rows <table> <exact count>       for every table in schema public
--   ledger_balance shops=<n> total=<sum> sha256=<hex>
-- The ledger line follows the single balance rule of ADR-0014: per shop, the sum of DEBT minus
-- the sum of PAYMENT over entries that are neither reversed nor a reversal
-- (reverses IS NULL AND reversed_by IS NULL). The hash covers "<shop id>:<balance>" pairs
-- ordered by shop id and joined with ",", so any changed amount, type, reversal link or shop
-- assignment changes it.
WITH table_rows AS (
    SELECT tablename,
           (xpath('/row/c/text()',
                  query_to_xml(format('SELECT count(*) AS c FROM public.%I', tablename), false, true, '')))[1]::text AS row_count
    FROM pg_tables
    WHERE schemaname = 'public'
),
shop_balances AS (
    SELECT shop_id,
           SUM(CASE type WHEN 'DEBT' THEN amount_minor WHEN 'PAYMENT' THEN -amount_minor END) AS balance
    FROM public.ledger_entries
    WHERE reverses IS NULL AND reversed_by IS NULL
    GROUP BY shop_id
),
lines AS (
    SELECT 'rows ' || tablename || ' ' || row_count AS line FROM table_rows
    UNION ALL
    SELECT 'ledger_balance shops=' || count(*)
           || ' total=' || COALESCE(SUM(balance), 0)
           || ' sha256=' || encode(sha256(convert_to(
                  COALESCE(string_agg(shop_id::text || ':' || balance::text, ',' ORDER BY shop_id), ''), 'UTF8')), 'hex')
    FROM shop_balances
)
SELECT line FROM lines ORDER BY line COLLATE "C"
