CREATE TABLE "user_roles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_roles_role_values" CHECK ("user_roles"."role" IN ('admin', 'member'))
);
--> statement-breakpoint
CREATE INDEX "businesses_claimed_by_idx" ON "businesses" USING btree ("claimed_by");--> statement-breakpoint
CREATE INDEX "businesses_discovered_in_run_idx" ON "businesses" USING btree ("discovered_in_run");--> statement-breakpoint
CREATE INDEX "field_metadata_run_id_idx" ON "field_metadata" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "merge_snapshots_survivor_id_idx" ON "merge_snapshots" USING btree ("survivor_id");--> statement-breakpoint
CREATE INDEX "merge_snapshots_loser_id_idx" ON "merge_snapshots" USING btree ("loser_id");--> statement-breakpoint
CREATE INDEX "outcomes_business_id_idx" ON "outcomes" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "provider_calls_run_id_idx" ON "provider_calls" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "provider_calls_business_id_idx" ON "provider_calls" USING btree ("business_id");