CREATE TYPE "public"."venue_import_status" AS ENUM('queued', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "venue_imports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_by" uuid,
	"status" "venue_import_status" DEFAULT 'queued' NOT NULL,
	"dry_run" boolean DEFAULT false NOT NULL,
	"csv" text NOT NULL,
	"total_rows" integer,
	"created_rows" integer DEFAULT 0 NOT NULL,
	"skipped_rows" integer DEFAULT 0 NOT NULL,
	"rejected_rows" integer DEFAULT 0 NOT NULL,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"failure_reason" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "venue_imports_csv_length" CHECK (char_length("venue_imports"."csv") between 1 and 900000),
	CONSTRAINT "venue_imports_counters" CHECK ("venue_imports"."created_rows" >= 0 and "venue_imports"."skipped_rows" >= 0 and "venue_imports"."rejected_rows" >= 0 and ("venue_imports"."total_rows" is null or "venue_imports"."total_rows" between 0 and 5000)),
	CONSTRAINT "venue_imports_issues" CHECK (jsonb_typeof("venue_imports"."issues") = 'array' and jsonb_array_length("venue_imports"."issues") <= 50),
	CONSTRAINT "venue_imports_completed_state" CHECK (("venue_imports"."status" in ('completed', 'failed')) = ("venue_imports"."completed_at" is not null)),
	CONSTRAINT "venue_imports_failure_reason" CHECK (("venue_imports"."status" = 'failed') = ("venue_imports"."failure_reason" is not null)),
	CONSTRAINT "venue_imports_dry_run_creates_nothing" CHECK (not "venue_imports"."dry_run" or "venue_imports"."created_rows" = 0)
);
--> statement-breakpoint
ALTER TABLE "venue_imports" ADD CONSTRAINT "venue_imports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "venue_imports_created_at_idx" ON "venue_imports" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "venue_imports_created_by_idx" ON "venue_imports" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "venue_imports_open_idx" ON "venue_imports" USING btree ("created_at") WHERE "venue_imports"."status" in ('queued', 'processing');--> statement-breakpoint
-- ADR-0064: the web role stores an import request and reads its state; the worker reads it and
-- records progress. Neither role deletes rows.
GRANT SELECT, INSERT ON venue_imports TO kadro_app;--> statement-breakpoint
GRANT SELECT ON venue_imports TO kadro_worker;--> statement-breakpoint
GRANT UPDATE (status, total_rows, created_rows, skipped_rows, rejected_rows, issues, failure_reason, started_at, completed_at, updated_at) ON venue_imports TO kadro_worker;
