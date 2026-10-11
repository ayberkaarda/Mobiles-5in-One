-- Ledger invariants checked on a restored database (docs/ops/backup-restore.md, ADR-0014).
-- One read-only statement returning one line per rule: "<rule> <violations>". Every count must
-- be 0. Used by restore-drill.sh (psql) and BackupRestoreDrillTest (JDBC).
SELECT rule || ' ' || violations
FROM (
    -- an entry marked reversed points at a reversal that exists, points back, and matches
    -- customer, type and amount
    SELECT 'reversal_pairs_consistent' AS rule, count(*) AS violations
    FROM public.ledger_entries e
    LEFT JOIN public.ledger_entries r ON r.id = e.reversed_by
    WHERE e.reversed_by IS NOT NULL
      AND (r.id IS NULL OR r.reverses IS DISTINCT FROM e.id OR r.customer_id <> e.customer_id
           OR r.type <> e.type OR r.amount_minor <> e.amount_minor)
    UNION ALL
    -- every reversal is acknowledged by its original
    SELECT 'reversals_acknowledged', count(*)
    FROM public.ledger_entries r
    LEFT JOIN public.ledger_entries e ON e.id = r.reverses
    WHERE r.reverses IS NOT NULL AND (e.id IS NULL OR e.reversed_by IS DISTINCT FROM r.id)
    UNION ALL
    -- entries stay inside the shop of their customer
    SELECT 'entries_in_customer_shop', count(*)
    FROM public.ledger_entries e
    JOIN public.customers c ON c.id = e.customer_id
    WHERE c.shop_id <> e.shop_id
) checks
ORDER BY rule
