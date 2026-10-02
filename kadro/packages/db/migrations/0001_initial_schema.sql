CREATE TYPE "public"."application_status" AS ENUM('pending', 'accepted', 'rejected', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."email_token_purpose" AS ENUM('verify', 'reset');--> statement-breakpoint
CREATE TYPE "public"."lineup_side" AS ENUM('A', 'B');--> statement-breakpoint
CREATE TYPE "public"."match_format" AS ENUM('5v5', '6v6', '7v7', '8v8');--> statement-breakpoint
CREATE TYPE "public"."match_status" AS ENUM('draft', 'open', 'locked', 'played', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."open_call_status" AS ENUM('open', 'closed', 'expired', 'removed');--> statement-breakpoint
CREATE TYPE "public"."player_level" AS ENUM('casual', 'regular', 'competitive');--> statement-breakpoint
CREATE TYPE "public"."player_position" AS ENUM('GK', 'DEF', 'MID', 'FWD');--> statement-breakpoint
CREATE TYPE "public"."push_platform" AS ENUM('ios', 'android');--> statement-breakpoint
CREATE TYPE "public"."rsvp_status" AS ENUM('in', 'out', 'maybe', 'waitlist');--> statement-breakpoint
CREATE TYPE "public"."session_client" AS ENUM('mobile', 'web');--> statement-breakpoint
CREATE TYPE "public"."subscription_environment" AS ENUM('sandbox', 'production');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('active', 'grace_period', 'billing_issue', 'paused', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."team_role" AS ENUM('captain', 'co_captain', 'player');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'moderator', 'admin');--> statement-breakpoint
CREATE TYPE "public"."webhook_provider" AS ENUM('revenuecat');--> statement-breakpoint
CREATE TABLE "districts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"il" text NOT NULL,
	"ilce" text NOT NULL,
	"il_slug" text NOT NULL,
	"slug" text NOT NULL,
	"centroid" geography(Point, 4326) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "districts_il_slug_format" CHECK ("districts"."il_slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "districts_slug_format" CHECK ("districts"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE TABLE "deletion_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"grace_until" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deletion_requests_grace_after_request" CHECK ("deletion_requests"."grace_until" > "deletion_requests"."requested_at")
);
--> statement-breakpoint
CREATE TABLE "email_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" "email_token_purpose" NOT NULL,
	"token_hash" char(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_tokens_token_hash_format" CHECK ("email_tokens"."token_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"token_hash" char(64) NOT NULL,
	"user_id" uuid NOT NULL,
	"client" "session_client" NOT NULL,
	"family_id" uuid NOT NULL,
	"device_label" text,
	"expires_at" timestamp with time zone NOT NULL,
	"rotated_from" uuid,
	"revoked_at" timestamp with time zone,
	"step_up_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_tokens_token_hash_format" CHECK ("refresh_tokens"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "refresh_tokens_device_label_length" CHECK (char_length("refresh_tokens"."device_label") <= 64)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"email_verified_at" timestamp with time zone,
	"password_hash" text,
	"apple_sub" text,
	"google_sub" text,
	"display_name" text NOT NULL,
	"avatar_key" text,
	"position" "player_position",
	"level" "player_level",
	"district_id" uuid,
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"totp_secret_enc" text,
	"totp_last_used_step" bigint,
	"deactivated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_length" CHECK (char_length("users"."email") between 3 and 254),
	CONSTRAINT "users_display_name_length" CHECK (char_length("users"."display_name") between 2 and 40),
	CONSTRAINT "users_password_hash_argon2id" CHECK ("users"."password_hash" is null or "users"."password_hash" like '$argon2id$%')
);
--> statement-breakpoint
CREATE TABLE "team_invites" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"code_hash" char(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"max_uses" integer NOT NULL,
	"uses" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_invites_code_hash_format" CHECK ("team_invites"."code_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "team_invites_max_uses_range" CHECK ("team_invites"."max_uses" between 1 and 50),
	CONSTRAINT "team_invites_uses_range" CHECK ("team_invites"."uses" between 0 and "team_invites"."max_uses")
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "team_role" DEFAULT 'player' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"badge_key" text,
	"district_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"is_pro_locked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teams_name_length" CHECK (char_length("teams"."name") between 2 and 60),
	CONSTRAINT "teams_slug_format" CHECK ("teams"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE TABLE "venue_reviews" (
	"id" uuid PRIMARY KEY NOT NULL,
	"venue_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"rating" smallint NOT NULL,
	"text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "venue_reviews_rating_range" CHECK ("venue_reviews"."rating" between 1 and 5),
	CONSTRAINT "venue_reviews_text_length" CHECK (char_length("venue_reviews"."text") <= 500)
);
--> statement-breakpoint
CREATE TABLE "venues" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"district_id" uuid NOT NULL,
	"point" geography(Point, 4326) NOT NULL,
	"address" text,
	"phone" text,
	"indoor" boolean DEFAULT false NOT NULL,
	"features" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"price_min_minor" integer,
	"price_max_minor" integer,
	"verified" boolean DEFAULT false NOT NULL,
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "venues_name_length" CHECK (char_length("venues"."name") between 2 and 120),
	CONSTRAINT "venues_slug_format" CHECK ("venues"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "venues_features_object" CHECK (jsonb_typeof("venues"."features") = 'object'),
	CONSTRAINT "venues_price_range" CHECK (("venues"."price_min_minor" is null or "venues"."price_min_minor" >= 0) and ("venues"."price_max_minor" is null or "venues"."price_max_minor" >= 0) and ("venues"."price_min_minor" is null or "venues"."price_max_minor" is null or "venues"."price_min_minor" <= "venues"."price_max_minor")),
	CONSTRAINT "venues_sample_name_prefix" CHECK (not "venues"."is_sample" or "venues"."name" like '[ÖRNEK] %')
);
--> statement-breakpoint
CREATE TABLE "match_rsvps" (
	"id" uuid PRIMARY KEY NOT NULL,
	"match_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "rsvp_status" NOT NULL,
	"side" "lineup_side",
	"paid" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"venue_id" uuid,
	"venue_text" text,
	"starts_at" timestamp with time zone NOT NULL,
	"format" "match_format" NOT NULL,
	"fee_total_minor" integer DEFAULT 0 NOT NULL,
	"slots" smallint NOT NULL,
	"status" "match_status" DEFAULT 'draft' NOT NULL,
	"locked_at" timestamp with time zone,
	"mvp_vote_closes_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matches_fee_total_minor_range" CHECK ("matches"."fee_total_minor" between 0 and 100000000),
	CONSTRAINT "matches_slots_range" CHECK ("matches"."slots" between 2 and 30),
	CONSTRAINT "matches_venue_text_length" CHECK (char_length("matches"."venue_text") <= 200),
	CONSTRAINT "matches_locked_has_locked_at" CHECK ("matches"."status" <> 'locked' or "matches"."locked_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "mvp_votes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"match_id" uuid NOT NULL,
	"voter_id" uuid NOT NULL,
	"votee_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mvp_votes_no_self_vote" CHECK ("mvp_votes"."voter_id" <> "mvp_votes"."votee_id")
);
--> statement-breakpoint
CREATE TABLE "open_call_applications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"open_call_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"message" text,
	"status" "application_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "open_call_applications_message_length" CHECK (char_length("open_call_applications"."message") <= 280)
);
--> statement-breakpoint
CREATE TABLE "open_calls" (
	"id" uuid PRIMARY KEY NOT NULL,
	"match_id" uuid NOT NULL,
	"missing_count" smallint NOT NULL,
	"position" "player_position",
	"level" "player_level" NOT NULL,
	"district_id" uuid NOT NULL,
	"status" "open_call_status" DEFAULT 'open' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "open_calls_missing_count_range" CHECK ("open_calls"."missing_count" between 0 and 30)
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid,
	"ip_hash" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_logs_metadata_object" CHECK (jsonb_typeof("audit_logs"."metadata") = 'object')
);
--> statement-breakpoint
CREATE TABLE "push_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expo_token" text NOT NULL,
	"platform" "push_platform" NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_tokens_expo_token_length" CHECK (char_length("push_tokens"."expo_token") between 1 and 256)
);
--> statement-breakpoint
CREATE TABLE "rate_limit_buckets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rate_limit_buckets_count_non_negative" CHECK ("rate_limit_buckets"."count" >= 0),
	CONSTRAINT "rate_limit_buckets_key_length" CHECK (char_length("rate_limit_buckets"."key") between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"rc_app_user_id" text NOT NULL,
	"product_id" text NOT NULL,
	"status" "subscription_status" NOT NULL,
	"expires_at" timestamp with time zone,
	"environment" "subscription_environment" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider" "webhook_provider" NOT NULL,
	"event_id" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"payload_hash" char(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_events_payload_hash_format" CHECK ("webhook_events"."payload_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "deletion_requests" ADD CONSTRAINT "deletion_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_tokens" ADD CONSTRAINT "email_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_rotated_from_refresh_tokens_id_fk" FOREIGN KEY ("rotated_from") REFERENCES "public"."refresh_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_district_id_districts_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."districts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_invites" ADD CONSTRAINT "team_invites_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_district_id_districts_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."districts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_reviews" ADD CONSTRAINT "venue_reviews_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_reviews" ADD CONSTRAINT "venue_reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venues" ADD CONSTRAINT "venues_district_id_districts_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."districts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venues" ADD CONSTRAINT "venues_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_rsvps" ADD CONSTRAINT "match_rsvps_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_rsvps" ADD CONSTRAINT "match_rsvps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mvp_votes" ADD CONSTRAINT "mvp_votes_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mvp_votes" ADD CONSTRAINT "mvp_votes_voter_id_users_id_fk" FOREIGN KEY ("voter_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mvp_votes" ADD CONSTRAINT "mvp_votes_votee_id_users_id_fk" FOREIGN KEY ("votee_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_call_applications" ADD CONSTRAINT "open_call_applications_open_call_id_open_calls_id_fk" FOREIGN KEY ("open_call_id") REFERENCES "public"."open_calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_call_applications" ADD CONSTRAINT "open_call_applications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_calls" ADD CONSTRAINT "open_calls_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_calls" ADD CONSTRAINT "open_calls_district_id_districts_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."districts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "districts_il_slug_slug_key" ON "districts" USING btree ("il_slug","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "districts_il_ilce_key" ON "districts" USING btree ("il","ilce");--> statement-breakpoint
CREATE INDEX "districts_centroid_gist" ON "districts" USING gist ("centroid");--> statement-breakpoint
CREATE UNIQUE INDEX "deletion_requests_pending_user_key" ON "deletion_requests" USING btree ("user_id") WHERE "deletion_requests"."completed_at" is null;--> statement-breakpoint
CREATE INDEX "deletion_requests_grace_until_idx" ON "deletion_requests" USING btree ("grace_until") WHERE "deletion_requests"."completed_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "email_tokens_token_hash_key" ON "email_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "email_tokens_user_id_purpose_idx" ON "email_tokens" USING btree ("user_id","purpose");--> statement-breakpoint
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_id_client_idx" ON "refresh_tokens" USING btree ("user_id","client");--> statement-breakpoint
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_rotated_from_idx" ON "refresh_tokens" USING btree ("rotated_from");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_key" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "users_apple_sub_key" ON "users" USING btree ("apple_sub");--> statement-breakpoint
CREATE UNIQUE INDEX "users_google_sub_key" ON "users" USING btree ("google_sub");--> statement-breakpoint
CREATE INDEX "users_district_id_idx" ON "users" USING btree ("district_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_invites_code_hash_key" ON "team_invites" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "team_invites_team_id_idx" ON "team_invites" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_members_team_id_user_id_key" ON "team_members" USING btree ("team_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_members_one_captain_key" ON "team_members" USING btree ("team_id") WHERE "team_members"."role" = 'captain';--> statement-breakpoint
CREATE INDEX "team_members_user_id_idx" ON "team_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_slug_key" ON "teams" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "teams_owner_id_idx" ON "teams" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "teams_district_id_idx" ON "teams" USING btree ("district_id");--> statement-breakpoint
CREATE UNIQUE INDEX "venue_reviews_venue_id_user_id_key" ON "venue_reviews" USING btree ("venue_id","user_id");--> statement-breakpoint
CREATE INDEX "venue_reviews_user_id_idx" ON "venue_reviews" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "venues_slug_key" ON "venues" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "venues_district_id_idx" ON "venues" USING btree ("district_id");--> statement-breakpoint
CREATE INDEX "venues_created_by_idx" ON "venues" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "venues_point_gist" ON "venues" USING gist ("point");--> statement-breakpoint
CREATE UNIQUE INDEX "match_rsvps_match_id_user_id_key" ON "match_rsvps" USING btree ("match_id","user_id");--> statement-breakpoint
CREATE INDEX "match_rsvps_user_id_idx" ON "match_rsvps" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "match_rsvps_match_id_status_idx" ON "match_rsvps" USING btree ("match_id","status");--> statement-breakpoint
CREATE INDEX "matches_team_id_starts_at_idx" ON "matches" USING btree ("team_id","starts_at");--> statement-breakpoint
CREATE INDEX "matches_venue_id_idx" ON "matches" USING btree ("venue_id");--> statement-breakpoint
CREATE INDEX "matches_status_starts_at_idx" ON "matches" USING btree ("status","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mvp_votes_match_id_voter_id_key" ON "mvp_votes" USING btree ("match_id","voter_id");--> statement-breakpoint
CREATE INDEX "mvp_votes_match_id_votee_id_idx" ON "mvp_votes" USING btree ("match_id","votee_id");--> statement-breakpoint
CREATE INDEX "mvp_votes_voter_id_idx" ON "mvp_votes" USING btree ("voter_id");--> statement-breakpoint
CREATE INDEX "mvp_votes_votee_id_idx" ON "mvp_votes" USING btree ("votee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "open_call_applications_open_call_id_user_id_key" ON "open_call_applications" USING btree ("open_call_id","user_id");--> statement-breakpoint
CREATE INDEX "open_call_applications_user_id_idx" ON "open_call_applications" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "open_calls_one_open_per_match_key" ON "open_calls" USING btree ("match_id") WHERE "open_calls"."status" = 'open';--> statement-breakpoint
CREATE INDEX "open_calls_match_id_idx" ON "open_calls" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX "open_calls_district_id_status_expires_at_idx" ON "open_calls" USING btree ("district_id","status","expires_at");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_target_idx" ON "audit_logs" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "push_tokens_expo_token_key" ON "push_tokens" USING btree ("expo_token");--> statement-breakpoint
CREATE INDEX "push_tokens_user_id_idx" ON "push_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rate_limit_buckets_key_window_start_key" ON "rate_limit_buckets" USING btree ("key","window_start");--> statement-breakpoint
CREATE INDEX "rate_limit_buckets_window_start_idx" ON "rate_limit_buckets" USING btree ("window_start");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_user_id_product_id_environment_key" ON "subscriptions" USING btree ("user_id","product_id","environment");--> statement-breakpoint
CREATE INDEX "subscriptions_rc_app_user_id_idx" ON "subscriptions" USING btree ("rc_app_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_provider_event_id_key" ON "webhook_events" USING btree ("provider","event_id");--> statement-breakpoint
CREATE INDEX "webhook_events_unprocessed_idx" ON "webhook_events" USING btree ("received_at") WHERE "webhook_events"."processed_at" is null;