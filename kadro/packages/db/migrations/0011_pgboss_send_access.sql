-- Handoff worker-to-db-001: a send-only pg-boss client (supervise, schedule and migrate off)
-- reads pgboss.version in start() to check the schema version. Redefines the grant function of
-- 0010 so kadro_app also gets SELECT on that table. The grant set stays minimal: SELECT on
-- pgboss.version and pgboss.queue, INSERT plus SELECT (id, start_after) on the job table and its
-- partitions. kadro_app cannot read job payloads, fetch, complete or delete jobs, or touch any
-- other pg-boss table.
CREATE OR REPLACE FUNCTION public.kadro_grant_pgboss_send_access() RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  part regclass;
BEGIN
  IF to_regclass('pgboss.job') IS NULL
    OR to_regclass('pgboss.queue') IS NULL
    OR to_regclass('pgboss.version') IS NULL THEN
    RAISE EXCEPTION 'pg-boss tables are missing; start the worker so it can create them first'
      USING ERRCODE = 'undefined_table';
  END IF;
  EXECUTE 'GRANT SELECT ON pgboss.version TO kadro_app';
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
