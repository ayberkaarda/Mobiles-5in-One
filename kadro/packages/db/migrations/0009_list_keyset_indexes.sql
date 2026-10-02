DROP INDEX "team_members_user_id_idx";--> statement-breakpoint
CREATE INDEX "team_members_user_id_joined_at_team_id_idx" ON "team_members" USING btree ("user_id","joined_at","team_id");--> statement-breakpoint
CREATE INDEX "open_call_applications_open_call_id_created_at_id_idx" ON "open_call_applications" USING btree ("open_call_id","created_at","id");