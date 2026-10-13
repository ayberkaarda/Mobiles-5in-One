-- Re-applies one account deletion request on a restored database (replay-deletions.sh,
-- docs/ops/backup-restore.md). psql variables: uid (account id), requested_at (UTC time of the
-- original request, ISO 8601). It repeats the immediate part of `request_deletion`
-- (api/app/auth/service.py): deactivate, schedule the hard delete 7 days after the original
-- request (INECEKVAR_DELETION_GRACE_DAYS default), revoke sessions and refresh tokens, drop
-- step-ups, favorites and traces, withdraw pending edits, and audit the replay without personal
-- data. The hourly `deletion.hard_delete` job completes the request on its schedule. Idempotent:
-- a second run changes nothing.
BEGIN;
SELECT id FROM public.users WHERE id = :'uid'::uuid FOR UPDATE;
UPDATE public.users
SET deactivated_at = COALESCE(deactivated_at, :'requested_at'::timestamptz), updated_at = now()
WHERE id = :'uid'::uuid;
INSERT INTO public.deletion_requests (id, user_id, state, scheduled_for, created_at, updated_at)
SELECT gen_random_uuid(), u.id, 'scheduled', :'requested_at'::timestamptz + interval '7 days',
       :'requested_at'::timestamptz, now()
FROM public.users u
WHERE u.id = :'uid'::uuid
  AND NOT EXISTS (SELECT 1 FROM public.deletion_requests d WHERE d.user_id = u.id AND d.state = 'scheduled');
UPDATE public.sessions SET revoked_at = now(), updated_at = now()
WHERE user_id = :'uid'::uuid AND revoked_at IS NULL;
UPDATE public.refresh_tokens SET revoked_at = now(), revoked_reason = 'account_deleted', updated_at = now()
WHERE user_id = :'uid'::uuid AND revoked_at IS NULL;
DELETE FROM public.session_step_ups WHERE user_id = :'uid'::uuid;
DELETE FROM public.favorites WHERE user_id = :'uid'::uuid;
DELETE FROM public.traces WHERE author_id = :'uid'::uuid;
UPDATE public.edits SET state = 'withdrawn', updated_at = now()
WHERE author_id = :'uid'::uuid AND state = 'pending';
INSERT INTO public.audit_logs (id, actor_id, action, target_type, target_id, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'account.delete_replayed', 'user', u.id, now(), now()
FROM public.users u
WHERE u.id = :'uid'::uuid
  AND NOT EXISTS (SELECT 1 FROM public.audit_logs a
                  WHERE a.action = 'account.delete_replayed' AND a.target_id = u.id);
COMMIT;
