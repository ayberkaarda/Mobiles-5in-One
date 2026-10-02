-- ADR-0028: database roles and grants.
--
-- kadro_app (web/API) and kadro_worker (pg-boss worker) are NOLOGIN group roles. Operators create
-- the login users per environment and grant membership (GRANT kadro_app TO <login>); passwords
-- never appear in migrations. The migration role needs CREATEROLE on the first run.
DO $$
BEGIN
  CREATE ROLE kadro_app NOLOGIN;
EXCEPTION
  WHEN duplicate_object OR unique_violation THEN NULL;
END
$$;--> statement-breakpoint
DO $$
BEGIN
  CREATE ROLE kadro_worker NOLOGIN;
EXCEPTION
  WHEN duplicate_object OR unique_violation THEN NULL;
END
$$;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO kadro_app, kadro_worker;--> statement-breakpoint
-- Domain tables: both roles read and write. Exceptions follow below.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  users, refresh_tokens, email_tokens, deletion_requests, districts, teams, team_members,
  team_invites, venues, venue_reviews, matches, match_rsvps, mvp_votes, open_calls,
  open_call_applications, push_tokens, subscriptions, webhook_events, rate_limit_buckets, uploads
  TO kadro_app, kadro_worker;--> statement-breakpoint
-- audit_logs is append-only for every application role.
GRANT SELECT, INSERT ON audit_logs TO kadro_app, kadro_worker;--> statement-breakpoint
-- job_receipts belongs to the worker; the web role has no access at all.
GRANT SELECT, INSERT, DELETE ON job_receipts TO kadro_worker;--> statement-breakpoint
REVOKE ALL ON job_receipts FROM kadro_app;--> statement-breakpoint
-- pg-boss lives in its own schema owned by the worker, which runs the pg-boss migrations.
CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION kadro_worker;--> statement-breakpoint
ALTER SCHEMA pgboss OWNER TO kadro_worker;--> statement-breakpoint
GRANT USAGE ON SCHEMA pgboss TO kadro_app;--> statement-breakpoint
-- The pg-boss tables do not exist until the worker has started once, and each new queue adds a
-- job partition. The worker therefore calls this function (as owner of the tables) after it has
-- created its queues. It grants kadro_app exactly what a send-only client needs: INSERT into the
-- job table and its partitions (plus the id/start_after columns pg-boss returns), and SELECT on
-- the queue table. Nothing else in pgboss is readable or writable by the web role.
CREATE OR REPLACE FUNCTION public.kadro_grant_pgboss_send_access() RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  part regclass;
BEGIN
  IF to_regclass('pgboss.job') IS NULL OR to_regclass('pgboss.queue') IS NULL THEN
    RAISE EXCEPTION 'pg-boss tables are missing; start the worker so it can create them first'
      USING ERRCODE = 'undefined_table';
  END IF;
  EXECUTE 'GRANT SELECT ON pgboss.queue TO kadro_app';
  EXECUTE 'GRANT INSERT, SELECT (id, start_after) ON pgboss.job TO kadro_app';
  FOR part IN
    SELECT relid FROM pg_partition_tree('pgboss.job'::regclass) WHERE relid <> 'pgboss.job'::regclass
  LOOP
    EXECUTE format('GRANT INSERT, SELECT (id, start_after) ON %s TO kadro_app', part);
  END LOOP;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.kadro_grant_pgboss_send_access() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.kadro_grant_pgboss_send_access() TO kadro_worker;
