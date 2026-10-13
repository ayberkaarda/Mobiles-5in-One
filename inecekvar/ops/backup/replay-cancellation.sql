-- Re-applies one deletion cancellation on a restored database (replay-deletions.sh,
-- docs/ops/backup-restore.md). psql variables: uid (account id), cancelled_at (UTC time of the
-- cancellation, ISO 8601). It repeats `cancel_scheduled_deletion` (api/app/me/deletion.py) for a
-- request the dump carries but the user cancelled after the dump by signing in during the
-- grace period: the scheduled request becomes cancelled and the account active again. Sessions,
-- favorites and traces dropped by the original request stay dropped, as after a real
-- cancellation. Audited without personal data. Idempotent: a second run changes nothing.
BEGIN;
SELECT id FROM public.users WHERE id = :'uid'::uuid FOR UPDATE;
UPDATE public.deletion_requests
SET state = 'cancelled', cancelled_at = :'cancelled_at'::timestamptz, updated_at = now()
WHERE user_id = :'uid'::uuid AND state = 'scheduled' AND created_at <= :'cancelled_at'::timestamptz;
UPDATE public.users SET deactivated_at = NULL, updated_at = now()
WHERE id = :'uid'::uuid
  AND deactivated_at IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.deletion_requests d WHERE d.user_id = :'uid'::uuid AND d.state = 'scheduled');
INSERT INTO public.audit_logs (id, actor_id, action, target_type, target_id, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'account.delete_cancel_replayed', 'user', u.id, now(), now()
FROM public.users u
WHERE u.id = :'uid'::uuid
  AND NOT EXISTS (SELECT 1 FROM public.audit_logs a
                  WHERE a.action = 'account.delete_cancel_replayed' AND a.target_id = u.id);
COMMIT;
