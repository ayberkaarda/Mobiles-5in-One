CREATE TABLE "job_receipts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"queue" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_receipts_idempotency_key_length" CHECK (char_length("job_receipts"."idempotency_key") between 1 and 128),
	CONSTRAINT "job_receipts_queue_length" CHECK (char_length("job_receipts"."queue") between 1 and 100)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "job_receipts_queue_idempotency_key_key" ON "job_receipts" USING btree ("queue","idempotency_key");--> statement-breakpoint
CREATE INDEX "job_receipts_created_at_idx" ON "job_receipts" USING btree ("created_at");