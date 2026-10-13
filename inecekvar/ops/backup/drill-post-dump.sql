-- Changes the drill makes on the source after the dump (drill-e2e.sh), so the restore has to
-- deal with work the dump does not hold.
--   d005 asks for deletion: the immediate part of request_deletion (api/app/auth/service.py):
--        deactivate, schedule 7 days ahead, revoke the session and refresh token, delete
--        favorites and traces, withdraw the pending edit, audit. The dump still has d005 active,
--        so the restore drill must re-apply this request or fail with it flagged.
--   d004 is erased as the hourly hard delete would after its grace: the user row and its request
--        disappear from the source. The dump still holds the due request, which the restored
--        worker completes; the drill checks that request keeps its immediate effects.
BEGIN;
UPDATE public.users SET deactivated_at = now(), updated_at = now()
WHERE id = '01990000-0000-7000-8000-00000000d005';
INSERT INTO public.deletion_requests (id, user_id, state, scheduled_for, created_at, updated_at)
VALUES (gen_random_uuid(), '01990000-0000-7000-8000-00000000d005', 'scheduled', now() + interval '7 days', now(), now());
UPDATE public.sessions SET revoked_at = now(), updated_at = now()
WHERE user_id = '01990000-0000-7000-8000-00000000d005' AND revoked_at IS NULL;
UPDATE public.refresh_tokens SET revoked_at = now(), revoked_reason = 'account_deleted', updated_at = now()
WHERE user_id = '01990000-0000-7000-8000-00000000d005' AND revoked_at IS NULL;
DELETE FROM public.favorites WHERE user_id = '01990000-0000-7000-8000-00000000d005';
DELETE FROM public.traces WHERE author_id = '01990000-0000-7000-8000-00000000d005';
UPDATE public.edits SET state = 'withdrawn', updated_at = now()
WHERE author_id = '01990000-0000-7000-8000-00000000d005' AND state = 'pending';
INSERT INTO public.audit_logs (id, actor_id, action, target_type, target_id)
VALUES (gen_random_uuid(), NULL, 'account.delete_requested', 'user', '01990000-0000-7000-8000-00000000d005');

UPDATE public.audit_logs SET target_id = NULL
WHERE target_type = 'user' AND target_id = '01990000-0000-7000-8000-00000000d004';
DELETE FROM public.edits WHERE author_id = '01990000-0000-7000-8000-00000000d004' AND state <> 'approved';
DELETE FROM public.users WHERE id = '01990000-0000-7000-8000-00000000d004';
COMMIT;
