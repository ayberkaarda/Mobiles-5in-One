-- State of one account after a restore, for the deletion replay (replay-deletions.sh).
-- psql variable: uid. One line: absent (no such account in the database), missing (account
-- present, no scheduled or completed request, or immediate effects not applied) or present
-- (deactivated with a scheduled request and no traces, favorites, pending edits or live
-- sessions left).
SELECT CASE
    WHEN u.id IS NULL THEN 'absent'
    WHEN u.deactivated_at IS NOT NULL
         AND EXISTS (SELECT 1 FROM public.deletion_requests d WHERE d.user_id = u.id AND d.state = 'scheduled')
         AND NOT EXISTS (SELECT 1 FROM public.traces t WHERE t.author_id = u.id)
         AND NOT EXISTS (SELECT 1 FROM public.favorites f WHERE f.user_id = u.id)
         AND NOT EXISTS (SELECT 1 FROM public.edits e WHERE e.author_id = u.id AND e.state = 'pending')
         AND NOT EXISTS (SELECT 1 FROM public.sessions s WHERE s.user_id = u.id AND s.revoked_at IS NULL)
         AND NOT EXISTS (SELECT 1 FROM public.refresh_tokens r WHERE r.user_id = u.id AND r.revoked_at IS NULL)
        THEN 'present'
    ELSE 'missing'
END
FROM (SELECT 1) one
LEFT JOIN public.users u ON u.id = :'uid'::uuid
