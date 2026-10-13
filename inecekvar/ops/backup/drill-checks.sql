-- Restore checks of an Inecek Var database (docs/ops/backup-restore.md, ADR-0053).
-- One read-only statement returning one line per rule: "<rule> <violations>". Every count must
-- be 0. restore-drill.sh requires exactly these rules, so a missing line fails as well.
SELECT rule || ' ' || violations
FROM (
    -- the published lines a rider sees: there must be at least one
    SELECT 'published_lines_present' AS rule,
           CASE WHEN count(*) > 0 THEN 0 ELSE 1 END AS violations
    FROM public.lines
    WHERE status = 'published'
    UNION ALL
    -- every published line points at a version with a valid, non-empty WGS 84 LINESTRING of at
    -- least two points
    SELECT 'published_line_geometry_valid', count(*)
    FROM public.lines l
    LEFT JOIN public.line_versions v ON v.id = l.current_version_id AND v.line_id = l.id
    WHERE l.status = 'published'
      AND (v.id IS NULL OR v.geom IS NULL OR ST_IsEmpty(v.geom) OR NOT ST_IsValid(v.geom)
           OR GeometryType(v.geom) <> 'LINESTRING' OR ST_SRID(v.geom) <> 4326 OR ST_NPoints(v.geom) < 2)
    UNION ALL
    -- every published line has at least two stops on its current version
    SELECT 'published_line_at_least_2_stops', count(*)
    FROM public.lines l
    WHERE l.status = 'published'
      AND (SELECT count(*) FROM public.line_stops ls WHERE ls.line_version_id = l.current_version_id) < 2
    UNION ALL
    -- the stops of a published line exist and belong to the city of the line
    SELECT 'published_line_stops_in_city', count(*)
    FROM public.lines l
    JOIN public.line_stops ls ON ls.line_version_id = l.current_version_id
    LEFT JOIN public.stops s ON s.id = ls.stop_id
    WHERE l.status = 'published' AND (s.id IS NULL OR s.city_id <> l.city_id)
    UNION ALL
    -- TOTP secrets are still AES-GCM blobs (format byte 2 with key id, nonce and tag, or the
    -- legacy format byte 1), never readable base32 text
    SELECT 'totp_secret_still_ciphertext', count(*)
    FROM public.users
    WHERE totp_secret_enc IS NOT NULL
      AND (NOT ((get_byte(totp_secret_enc, 0) = 2 AND octet_length(totp_secret_enc) >= 37)
                OR (get_byte(totp_secret_enc, 0) = 1 AND octet_length(totp_secret_enc) >= 29))
           OR encode(totp_secret_enc, 'escape') ~ '^[A-Z2-7=]+$')
    UNION ALL
    -- every scheduled deletion keeps its immediate effects: account deactivated, no traces,
    -- favorites or pending edits left
    SELECT 'scheduled_deletions_keep_immediate_effects', count(*)
    FROM public.deletion_requests d
    JOIN public.users u ON u.id = d.user_id
    WHERE d.state = 'scheduled'
      AND (u.deactivated_at IS NULL
           OR EXISTS (SELECT 1 FROM public.traces t WHERE t.author_id = u.id)
           OR EXISTS (SELECT 1 FROM public.favorites f WHERE f.user_id = u.id)
           OR EXISTS (SELECT 1 FROM public.edits e WHERE e.author_id = u.id AND e.state = 'pending'))
) checks
ORDER BY rule
