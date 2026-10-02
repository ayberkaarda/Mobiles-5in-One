ALTER TABLE "match_rsvps" ADD COLUMN "waitlisted_at" timestamp with time zone;--> statement-breakpoint
-- Existing waitlist rows (if any) keep their relative order: the last change time is the best
-- available approximation of when they joined the waitlist.
UPDATE "match_rsvps" SET "waitlisted_at" = "updated_at" WHERE "status" = 'waitlist';--> statement-breakpoint
CREATE INDEX "match_rsvps_waitlist_idx" ON "match_rsvps" USING btree ("match_id","waitlisted_at") WHERE "match_rsvps"."status" = 'waitlist';--> statement-breakpoint
ALTER TABLE "match_rsvps" ADD CONSTRAINT "match_rsvps_waitlisted_at_matches_status" CHECK (("match_rsvps"."status" = 'waitlist') = ("match_rsvps"."waitlisted_at" is not null));
