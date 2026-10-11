-- Synthetic data for the restore drill (drill-e2e.sh, .github/workflows/cetele-restore-drill.yml).
-- Applied after migrations V1 to V8. No real person: fixed drill names, the synthetic owner
-- numbers +905550000001 to +905550000003, no customer phone numbers, no notes.
--   3 shops, each with one owner, 20 customers and 10 entries per customer (600 entries,
--   payments on every third), then 30 entries reversed (30 reversal rows, the originals get
--   reversed_by), so the balance rule has reversal pairs to skip.
BEGIN;

CREATE TEMP TABLE drill_shops ON COMMIT DROP AS
SELECT n, gen_random_uuid() AS shop_id, gen_random_uuid() AS owner_id
FROM generate_series(1, 3) AS n;

INSERT INTO users (id, phone_e164, display_name)
SELECT owner_id, '+90555000' || lpad(n::text, 4, '0'), 'Drill owner ' || n
FROM drill_shops;

INSERT INTO shops (id, name, type, il, ilce, created_by)
SELECT shop_id, 'Drill shop ' || n, (ARRAY['BAKKAL', 'MANAV', 'KASAP'])[n], 'Istanbul', 'Kadikoy', owner_id
FROM drill_shops;

INSERT INTO memberships (id, shop_id, user_id, role)
SELECT gen_random_uuid(), shop_id, owner_id, 'OWNER'
FROM drill_shops;

INSERT INTO shop_sequences (shop_id, last_seq)
SELECT shop_id, 0
FROM drill_shops;

CREATE TEMP TABLE drill_customers ON COMMIT DROP AS
SELECT gen_random_uuid() AS customer_id, s.n, s.shop_id, s.owner_id, c
FROM drill_shops s
CROSS JOIN generate_series(1, 20) AS c;

INSERT INTO customers (id, shop_id, name, created_by)
SELECT customer_id, shop_id, 'Drill customer ' || n || '-' || c, owner_id
FROM drill_customers;

INSERT INTO ledger_entries (id, shop_id, customer_id, client_id, type, amount_minor, occurred_on, created_by)
SELECT gen_random_uuid(), shop_id, customer_id, gen_random_uuid(),
       CASE WHEN e % 3 = 0 THEN 'PAYMENT' ELSE 'DEBT' END,
       100 * ((n * 31 + c * 7 + e * 13) % 500 + 1),
       DATE '2026-09-01' + (e % 30),
       owner_id
FROM drill_customers
CROSS JOIN generate_series(1, 10) AS e;

CREATE TEMP TABLE drill_reversed ON COMMIT DROP AS
SELECT id AS original_id, gen_random_uuid() AS reversal_id
FROM ledger_entries
ORDER BY id
LIMIT 30;

INSERT INTO ledger_entries (id, shop_id, customer_id, client_id, type, amount_minor, occurred_on, reverses, created_by)
SELECT r.reversal_id, e.shop_id, e.customer_id, gen_random_uuid(), e.type, e.amount_minor, DATE '2026-10-01', e.id, e.created_by
FROM drill_reversed r
JOIN ledger_entries e ON e.id = r.original_id;

UPDATE ledger_entries e
SET reversed_by = r.reversal_id
FROM drill_reversed r
WHERE e.id = r.original_id;

COMMIT;
