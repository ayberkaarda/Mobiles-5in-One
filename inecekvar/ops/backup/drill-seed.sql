-- Synthetic accounts for the restore drill (drill-e2e.sh), applied after `alembic upgrade head`
-- and the sample city seed (`python -m app.seed`, the sample city with three published lines).
-- No real person: fixed drill ids, addresses under the reserved .invalid domain, no password
-- hashes. psql variables totp_a and totp_b carry hex AES-GCM blobs made at run time by
-- app.auth.totp.encrypt_secret with a key that exists only inside that process.
--   d001 contributor with TOTP, two favorites, a trace, an approved and a pending edit
--   d002 moderator with TOTP, one favorite, reviewer of the approved edit of d001
--   d003 rider with a trace and a favorite
--   d004 asked for deletion 7 days and 1 hour before the dump: deactivated, request due, no
--        traces or favorites left, pending edit withdrawn (the hard delete has not run yet)
--   d005 active at dump time with a trace, a favorite, a pending edit, a session and a refresh
--        token; drill-post-dump.sql records its deletion request after the dump
BEGIN;

CREATE TEMP TABLE drill_lines ON COMMIT DROP AS
SELECT l.id, l.city_id, row_number() OVER (ORDER BY l.slug) AS n
FROM public.lines l
JOIN public.cities c ON c.id = l.city_id
WHERE c.slug = 'ornek-test-sehri' AND l.status = 'published';

DO $$
BEGIN
    IF (SELECT count(*) FROM drill_lines) < 3 THEN
        RAISE EXCEPTION 'the sample city seed must run first (expected 3 published lines)';
    END IF;
END
$$;

INSERT INTO public.users (id, email, email_verified_at, display_name, role, reputation, licence_accepted_at,
                          totp_secret_enc, totp_enabled_at, deactivated_at)
VALUES
    ('01990000-0000-7000-8000-00000000d001', 'drill-1@drill.invalid', now(), 'Drill contributor', 'contributor', 25, now(),
     decode(:'totp_a', 'hex'), now(), NULL),
    ('01990000-0000-7000-8000-00000000d002', 'drill-2@drill.invalid', now(), 'Drill moderator', 'moderator', 80, now(),
     decode(:'totp_b', 'hex'), now(), NULL),
    ('01990000-0000-7000-8000-00000000d003', 'drill-3@drill.invalid', now(), 'Drill rider', 'user', 0, NULL,
     NULL, NULL, NULL),
    ('01990000-0000-7000-8000-00000000d004', 'drill-4@drill.invalid', now(), 'Drill leaver', 'contributor', 5, now(),
     NULL, NULL, now() - interval '7 days 1 hour'),
    ('01990000-0000-7000-8000-00000000d005', 'drill-5@drill.invalid', now(), 'Drill late leaver', 'contributor', 3, now(),
     NULL, NULL, NULL);

INSERT INTO public.favorites (user_id, line_id)
SELECT f.u, l.id
FROM (VALUES ('01990000-0000-7000-8000-00000000d001'::uuid, 1), ('01990000-0000-7000-8000-00000000d001'::uuid, 2),
             ('01990000-0000-7000-8000-00000000d002'::uuid, 3), ('01990000-0000-7000-8000-00000000d003'::uuid, 1),
             ('01990000-0000-7000-8000-00000000d005'::uuid, 2)) AS f(u, n)
JOIN drill_lines l ON l.n = f.n;

INSERT INTO public.traces (id, author_id, city_id, points, started_at, ended_at, delete_after)
SELECT gen_random_uuid(), t.u, l.city_id,
       '[[34.011, 42.511], [34.021, 42.512], [34.031, 42.513]]'::jsonb,
       now() - interval '2 hours', now() - interval '1 hour', now() + interval '30 days'
FROM (VALUES ('01990000-0000-7000-8000-00000000d001'::uuid), ('01990000-0000-7000-8000-00000000d003'::uuid),
             ('01990000-0000-7000-8000-00000000d005'::uuid)) AS t(u)
JOIN drill_lines l ON l.n = 1;

INSERT INTO public.edits (id, kind, city_id, line_id, payload, state, author_id, reviewer_id, reason, reviewed_at)
SELECT gen_random_uuid(), 'fare_update', l.city_id, l.id, jsonb_build_object('fare_minor', e.fare), e.state,
       e.author, e.reviewer, NULL, CASE WHEN e.state IN ('pending', 'withdrawn') THEN NULL ELSE now() END
FROM (VALUES ('01990000-0000-7000-8000-00000000d001'::uuid, NULL::uuid, 'pending', 2750),
             ('01990000-0000-7000-8000-00000000d001'::uuid, '01990000-0000-7000-8000-00000000d002'::uuid, 'approved', 2600),
             ('01990000-0000-7000-8000-00000000d004'::uuid, NULL::uuid, 'withdrawn', 3100),
             ('01990000-0000-7000-8000-00000000d005'::uuid, NULL::uuid, 'pending', 3200)) AS e(author, reviewer, state, fare)
JOIN drill_lines l ON l.n = 2;

INSERT INTO public.deletion_requests (id, user_id, state, scheduled_for, created_at, updated_at)
VALUES (gen_random_uuid(), '01990000-0000-7000-8000-00000000d004', 'scheduled', now() - interval '1 hour',
        now() - interval '7 days 1 hour', now() - interval '7 days 1 hour');

INSERT INTO public.sessions (id, user_id, token_hash, expires_at, last_seen_at)
VALUES (gen_random_uuid(), '01990000-0000-7000-8000-00000000d005', sha256(convert_to(gen_random_uuid()::text, 'UTF8')),
        now() + interval '7 days', now());

INSERT INTO public.refresh_tokens (id, user_id, family_id, token_hash, expires_at)
VALUES (gen_random_uuid(), '01990000-0000-7000-8000-00000000d005', gen_random_uuid(),
        sha256(convert_to(gen_random_uuid()::text, 'UTF8')), now() + interval '30 days');

INSERT INTO public.audit_logs (id, actor_id, action, target_type, target_id)
VALUES (gen_random_uuid(), '01990000-0000-7000-8000-00000000d002', 'edit.approved', 'edit', NULL),
       (gen_random_uuid(), NULL, 'account.delete_requested', 'user', '01990000-0000-7000-8000-00000000d004');

COMMIT;
