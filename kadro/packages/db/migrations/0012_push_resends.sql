CREATE TABLE "push_resends" (
	"id" uuid PRIMARY KEY NOT NULL,
	"singleton_key" text NOT NULL,
	"type" text NOT NULL,
	"user_id" uuid NOT NULL,
	"ref_id" uuid NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_resends_singleton_key_length" CHECK (char_length("push_resends"."singleton_key") between 1 and 128),
	CONSTRAINT "push_resends_type" CHECK ("push_resends"."type" in ('rsvp.changed', 'application.received')),
	CONSTRAINT "push_resends_version_positive" CHECK ("push_resends"."version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "push_resends_singleton_key_key" ON "push_resends" USING btree ("singleton_key");--> statement-breakpoint
CREATE INDEX "push_resends_updated_at_idx" ON "push_resends" USING btree ("updated_at");--> statement-breakpoint
-- ADR-0044: the web role records dropped changes (insert, or bump the version of the pending row,
-- so UPDATE covers only version and updated_at); the worker reads and clears them. Neither role
-- gets more than that.
GRANT SELECT, INSERT ON push_resends TO kadro_app;--> statement-breakpoint
GRANT UPDATE (version, updated_at) ON push_resends TO kadro_app;--> statement-breakpoint
GRANT SELECT, DELETE ON push_resends TO kadro_worker;
