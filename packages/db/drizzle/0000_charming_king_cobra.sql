CREATE TYPE "public"."business_status" AS ENUM('active', 'merged', 'excluded', 'suppressed');--> statement-breakpoint
CREATE TYPE "public"."claim_status" AS ENUM('unclaimed', 'claimed', 'released');--> statement-breakpoint
CREATE TYPE "public"."error_code" AS ENUM('PROVIDER_TIMEOUT', 'PROVIDER_RATE_LIMITED', 'PROVIDER_QUOTA_EXHAUSTED', 'PROVIDER_AUTH_FAILED', 'PROVIDER_SCHEMA_INVALID', 'FETCH_BLOCKED', 'FETCH_NOT_FOUND', 'BUDGET_CEILING_REACHED', 'IDENTITY_CONFLICT', 'INTERNAL');--> statement-breakpoint
CREATE TYPE "public"."identity_key_type" AS ENUM('place_id', 'domain', 'phone', 'fb_page_id', 'name_location');--> statement-breakpoint
CREATE TYPE "public"."manual_review_reason" AS ENUM('unclear_website_status', 'shared_phone', 'potential_duplicate', 'no_evidence_for_route', 'identity_conflict');--> statement-breakpoint
CREATE TYPE "public"."objection_category" AS ENUM('none', 'price', 'timing', 'competition', 'authority', 'status_quo', 'technical');--> statement-breakpoint
CREATE TYPE "public"."outreach_channel" AS ENUM('call', 'message');--> statement-breakpoint
CREATE TYPE "public"."outreach_result" AS ENUM('no_answer', 'not_interested', 'interested', 'follow_up_requested', 'meeting_booked', 'do_not_contact', 'invalid_contact');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('planning', 'running', 'partial', 'complete', 'halted', 'failed');--> statement-breakpoint
CREATE TYPE "public"."service_area" AS ENUM('WEB', 'SEO', 'REP', 'CON', 'SOC', 'ADS');--> statement-breakpoint
CREATE TYPE "public"."terms_classification" AS ENUM('first_party', 'provider', 'api_restricted', 'derived', 'display_only');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('verified', 'unconfirmed', 'not_found', 'not_yet_validated');--> statement-breakpoint
CREATE TYPE "public"."website_status" AS ENUM('no_website', 'dead', 'social_only', 'live', 'unclear');--> statement-breakpoint
CREATE TABLE "businesses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "business_status" DEFAULT 'active' NOT NULL,
	"display_name" text NOT NULL,
	"name_normalized" text,
	"website_status" "website_status" DEFAULT 'unclear' NOT NULL,
	"lat_rounded" double precision,
	"lng_rounded" double precision,
	"city" text,
	"state" text,
	"country" text DEFAULT 'us' NOT NULL,
	"location_hash" text,
	"manual_review_status" boolean DEFAULT false NOT NULL,
	"manual_review_reasons" "manual_review_reason"[],
	"exclusion_flag" boolean DEFAULT false NOT NULL,
	"claimed_by" uuid,
	"claimed_at" timestamp with time zone,
	"claim_status" "claim_status" DEFAULT 'unclaimed' NOT NULL,
	"claim_release_at" timestamp with time zone,
	"passed_gate" boolean,
	"merged_into" uuid,
	"merged_at" timestamp with time zone,
	"discovered_in_run" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exclusions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reason" text NOT NULL,
	"key_type" "identity_key_type" NOT NULL,
	"key_value" text NOT NULL,
	"business_name" text,
	"added_by" uuid,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "field_metadata" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"field_name" text NOT NULL,
	"value" text,
	"source_name" text NOT NULL,
	"source_record_id" text,
	"verification_status" "verification_status" DEFAULT 'not_yet_validated' NOT NULL,
	"terms_classification" "terms_classification" DEFAULT 'first_party' NOT NULL,
	"run_id" uuid,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"next_refresh_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"key_type" "identity_key_type" NOT NULL,
	"key_value" text NOT NULL,
	"rank" smallint NOT NULL,
	"migrated_from" uuid,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "identity_keys_rank_range" CHECK ("identity_keys"."rank" >= 1 AND "identity_keys"."rank" <= 5)
);
--> statement-breakpoint
CREATE TABLE "merge_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"survivor_id" uuid NOT NULL,
	"loser_id" uuid NOT NULL,
	"pre_merge_survivor" jsonb NOT NULL,
	"pre_merge_loser" jsonb NOT NULL,
	"conflict_log" jsonb,
	"reason" text NOT NULL,
	"merged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reversed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"user_id" uuid,
	"channel" "outreach_channel" NOT NULL,
	"result" "outreach_result" NOT NULL,
	"objection" "objection_category" DEFAULT 'none' NOT NULL,
	"opener_area" "service_area",
	"notes" text,
	"meeting_date" timestamp with time zone,
	"original_business_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_calls" (
	"idempotency_key" text PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"business_id" uuid,
	"provider" text NOT NULL,
	"endpoint" text,
	"status" text NOT NULL,
	"error_code" "error_code",
	"cost_cents" integer,
	"response_ref" text,
	"called_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "run_status" DEFAULT 'planning' NOT NULL,
	"niche" text,
	"location" text,
	"radius_miles" integer,
	"stage_status" jsonb,
	"counters" jsonb,
	"spend" jsonb,
	"errors" jsonb,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppression_hashes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key_type" "identity_key_type" NOT NULL,
	"key_hash" text NOT NULL,
	"reason" text NOT NULL,
	"suppressed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_discovered_in_run_runs_id_fk" FOREIGN KEY ("discovered_in_run") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_metadata" ADD CONSTRAINT "field_metadata_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_metadata" ADD CONSTRAINT "field_metadata_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_keys" ADD CONSTRAINT "identity_keys_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merge_snapshots" ADD CONSTRAINT "merge_snapshots_survivor_id_businesses_id_fk" FOREIGN KEY ("survivor_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merge_snapshots" ADD CONSTRAINT "merge_snapshots_loser_id_businesses_id_fk" FOREIGN KEY ("loser_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_calls" ADD CONSTRAINT "provider_calls_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_calls" ADD CONSTRAINT "provider_calls_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "businesses_merged_into_idx" ON "businesses" USING btree ("merged_into");--> statement-breakpoint
CREATE INDEX "businesses_name_normalized_idx" ON "businesses" USING btree ("name_normalized");--> statement-breakpoint
CREATE INDEX "businesses_location_hash_idx" ON "businesses" USING btree ("location_hash");--> statement-breakpoint
CREATE INDEX "businesses_status_idx" ON "businesses" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "exclusions_type_value_unique" ON "exclusions" USING btree ("key_type","key_value");--> statement-breakpoint
CREATE UNIQUE INDEX "field_metadata_business_field_unique" ON "field_metadata" USING btree ("business_id","field_name");--> statement-breakpoint
CREATE INDEX "field_metadata_next_refresh_idx" ON "field_metadata" USING btree ("next_refresh_at");--> statement-breakpoint
CREATE UNIQUE INDEX "identity_keys_type_value_unique" ON "identity_keys" USING btree ("key_type","key_value");--> statement-breakpoint
CREATE INDEX "identity_keys_business_id_idx" ON "identity_keys" USING btree ("business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "suppression_hashes_type_hash_unique" ON "suppression_hashes" USING btree ("key_type","key_hash");