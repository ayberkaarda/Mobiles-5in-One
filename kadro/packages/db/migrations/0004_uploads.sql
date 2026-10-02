CREATE TYPE "public"."upload_content_type" AS ENUM('image/jpeg', 'image/png', 'image/webp');--> statement-breakpoint
CREATE TYPE "public"."upload_kind" AS ENUM('avatar', 'badge');--> statement-breakpoint
CREATE TYPE "public"."upload_reject_reason" AS ENUM('missing', 'size_mismatch', 'not_an_image', 'type_mismatch', 'too_many_pixels', 'decode_failed', 'expired', 'not_allowed');--> statement-breakpoint
CREATE TYPE "public"."upload_status" AS ENUM('pending', 'processing', 'ready', 'rejected', 'deleted');--> statement-breakpoint
CREATE TABLE "uploads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "upload_kind" NOT NULL,
	"team_id" uuid,
	"content_type" "upload_content_type" NOT NULL,
	"content_length" integer NOT NULL,
	"status" "upload_status" DEFAULT 'pending' NOT NULL,
	"reject_reason" "upload_reject_reason",
	"key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uploads_content_length_range" CHECK ("uploads"."content_length" between 1 and 2097152),
	CONSTRAINT "uploads_badge_has_team" CHECK (("uploads"."kind" = 'badge') = ("uploads"."team_id" is not null)),
	CONSTRAINT "uploads_rejected_has_reason" CHECK (("uploads"."status" = 'rejected') = ("uploads"."reject_reason" is not null)),
	CONSTRAINT "uploads_key_matches_owner" CHECK ("uploads"."key" = case "uploads"."kind" when 'avatar' then 'avatars/' || "uploads"."user_id"::text || '/' || "uploads"."id"::text else 'badges/' || "uploads"."team_id"::text || '/' || "uploads"."id"::text end)
);
--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uploads_key_key" ON "uploads" USING btree ("key");--> statement-breakpoint
CREATE INDEX "uploads_user_id_created_at_idx" ON "uploads" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "uploads_status_created_at_idx" ON "uploads" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "uploads_team_id_idx" ON "uploads" USING btree ("team_id");