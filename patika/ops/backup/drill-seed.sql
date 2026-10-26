-- Synthetic data for the restore drill only (ops/backup/drill.sh). Fixed ids, fake names, no real
-- person or address. Runs after the EF migrations, which already seed provinces and districts.
BEGIN;

INSERT INTO users (id, email, email_verified_at, display_name, district, role, urgent_opt_in, urgent_radius_m,
                   totp_secret_enc, created_at, updated_at)
VALUES
  ('d0000000-0000-7000-8000-000000000001', 'drill.volunteer@example.invalid', '2026-10-01T08:00:00Z',
   'DRILL Gonullu', 'Kadıköy', 'User', true, 2000, NULL, '2026-10-01T08:00:00Z', '2026-10-01T08:00:00Z'),
  ('d0000000-0000-7000-8000-000000000002', 'drill.admin@example.invalid', '2026-10-01T08:00:00Z',
   'DRILL Yonetici', NULL, 'Admin', false, 1000, 'CfDJ8drill-ciphertext-placeholder-not-a-secret',
   '2026-10-01T08:00:00Z', '2026-10-01T08:00:00Z');

INSERT INTO stations (id, name, location, kind, species, photo_key, created_by, status, last_fed_at, feedings_count,
                      district, created_at, updated_at)
VALUES
  ('d0000000-0000-7000-8000-000000000101', 'DRILL Moda Sahil', ST_SetSRID(ST_MakePoint(29.0265, 40.9806), 4326)::geography,
   'Both', 'Cat', 'station/d0000000-0000-7000-8000-000000000101', 'd0000000-0000-7000-8000-000000000001', 'Active',
   '2026-10-20T07:30:00Z', 3, 'Kadıköy', '2026-10-02T08:00:00Z', '2026-10-20T07:30:00Z'),
  ('d0000000-0000-7000-8000-000000000102', 'DRILL Yeldeğirmeni', ST_SetSRID(ST_MakePoint(29.0288, 40.9965), 4326)::geography,
   'Water', 'Mixed', 'station/d0000000-0000-7000-8000-000000000102', 'd0000000-0000-7000-8000-000000000001', 'Active',
   '2026-10-19T18:00:00Z', 2, 'Kadıköy', '2026-10-02T09:00:00Z', '2026-10-19T18:00:00Z'),
  ('d0000000-0000-7000-8000-000000000103', 'DRILL Kalamış', ST_SetSRID(ST_MakePoint(29.0391, 40.9772), 4326)::geography,
   'Food', 'Dog', 'station/d0000000-0000-7000-8000-000000000103', 'd0000000-0000-7000-8000-000000000001', 'NeedsRefill',
   NULL, 0, 'Kadıköy', '2026-10-03T08:00:00Z', '2026-10-03T08:00:00Z'),
  ('d0000000-0000-7000-8000-000000000104', 'DRILL Abbasağa', ST_SetSRID(ST_MakePoint(29.0067, 41.0458), 4326)::geography,
   'Both', 'Cat', 'station/d0000000-0000-7000-8000-000000000104', 'd0000000-0000-7000-8000-000000000001', 'Active',
   '2026-10-18T06:45:00Z', 1, 'Beşiktaş', '2026-10-04T08:00:00Z', '2026-10-18T06:45:00Z');

INSERT INTO feedings (id, station_id, user_id, at, note, created_at, updated_at)
VALUES
  ('d0000000-0000-7000-8000-000000000201', 'd0000000-0000-7000-8000-000000000101', 'd0000000-0000-7000-8000-000000000001',
   '2026-10-18T07:30:00Z', 'DRILL mama', '2026-10-18T07:30:00Z', '2026-10-18T07:30:00Z'),
  ('d0000000-0000-7000-8000-000000000202', 'd0000000-0000-7000-8000-000000000101', 'd0000000-0000-7000-8000-000000000001',
   '2026-10-19T07:30:00Z', NULL, '2026-10-19T07:30:00Z', '2026-10-19T07:30:00Z'),
  ('d0000000-0000-7000-8000-000000000203', 'd0000000-0000-7000-8000-000000000101', NULL,
   '2026-10-20T07:30:00Z', NULL, '2026-10-20T07:30:00Z', '2026-10-20T07:30:00Z'),
  ('d0000000-0000-7000-8000-000000000204', 'd0000000-0000-7000-8000-000000000102', 'd0000000-0000-7000-8000-000000000001',
   '2026-10-18T18:00:00Z', 'DRILL su', '2026-10-18T18:00:00Z', '2026-10-18T18:00:00Z'),
  ('d0000000-0000-7000-8000-000000000205', 'd0000000-0000-7000-8000-000000000102', 'd0000000-0000-7000-8000-000000000001',
   '2026-10-19T18:00:00Z', NULL, '2026-10-19T18:00:00Z', '2026-10-19T18:00:00Z'),
  ('d0000000-0000-7000-8000-000000000206', 'd0000000-0000-7000-8000-000000000104', 'd0000000-0000-7000-8000-000000000001',
   '2026-10-18T06:45:00Z', NULL, '2026-10-18T06:45:00Z', '2026-10-18T06:45:00Z');

INSERT INTO urgent_posts (id, location, category, description, photo_key, state, created_by, notified_count,
                          fanout_at, created_at, updated_at)
VALUES
  ('d0000000-0000-7000-8000-000000000301', ST_SetSRID(ST_MakePoint(29.0270, 40.9810), 4326)::geography, 'Injured',
   'DRILL yarali kedi', 'urgent/d0000000-0000-7000-8000-000000000301', 'Open', 'd0000000-0000-7000-8000-000000000001', 0,
   '2026-10-20T09:00:00Z', '2026-10-20T09:00:00Z', '2026-10-20T09:00:00Z');

COMMIT;
