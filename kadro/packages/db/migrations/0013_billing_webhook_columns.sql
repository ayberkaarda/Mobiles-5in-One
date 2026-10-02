CREATE TYPE "public"."subscription_store" AS ENUM('app_store', 'play_store', 'promotional', 'other');--> statement-breakpoint
CREATE TYPE "public"."webhook_outcome" AS ENUM('accepted', 'ignored');--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "store" "subscription_store";--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "last_event_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "last_event_id" text;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD COLUMN "event_type" text;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD COLUMN "app_user_id" text;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD COLUMN "product_id" text;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD COLUMN "store" "subscription_store";--> statement-breakpoint
ALTER TABLE "webhook_events" ADD COLUMN "environment" "subscription_environment";--> statement-breakpoint
ALTER TABLE "webhook_events" ADD COLUMN "event_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD COLUMN "outcome" "webhook_outcome";--> statement-breakpoint
ALTER TABLE "webhook_events" ADD COLUMN "ignored_reason" text;--> statement-breakpoint
CREATE INDEX "webhook_events_app_user_id_event_at_idx" ON "webhook_events" USING btree ("app_user_id","event_at");--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_last_event_id_length" CHECK ("subscriptions"."last_event_id" is null or char_length("subscriptions"."last_event_id") between 1 and 128);--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_text_lengths" CHECK (("webhook_events"."event_type" is null or char_length("webhook_events"."event_type") between 1 and 64) and ("webhook_events"."app_user_id" is null or char_length("webhook_events"."app_user_id") between 1 and 256) and ("webhook_events"."product_id" is null or char_length("webhook_events"."product_id") <= 200) and ("webhook_events"."ignored_reason" is null or char_length("webhook_events"."ignored_reason") between 1 and 64) and char_length("webhook_events"."event_id") between 1 and 128);--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_ignored_reason_matches_outcome" CHECK ("webhook_events"."outcome" is null or ("webhook_events"."outcome" = 'ignored') = ("webhook_events"."ignored_reason" is not null));