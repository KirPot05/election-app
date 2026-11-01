CREATE TYPE "public"."election_status" AS ENUM('DRAFT', 'OPEN', 'CLOSED', 'FINALIZED');--> statement-breakpoint
CREATE TYPE "public"."results_visibility" AS ENUM('LIVE', 'AFTER_CLOSE');--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"details" jsonb
);
--> statement-breakpoint
CREATE TABLE "ballot_choices" (
	"ballot_id" uuid NOT NULL,
	"election_id" integer NOT NULL,
	"candidate_id" integer NOT NULL,
	CONSTRAINT "ballot_choices_ballot_id_candidate_id_pk" PRIMARY KEY("ballot_id","candidate_id")
);
--> statement-breakpoint
CREATE TABLE "ballots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"election_id" integer NOT NULL,
	CONSTRAINT "ballots_id_election_unique" UNIQUE("id","election_id")
);
--> statement-breakpoint
CREATE TABLE "candidates" (
	"id" serial PRIMARY KEY NOT NULL,
	"election_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "candidates_id_election_unique" UNIQUE("id","election_id"),
	CONSTRAINT "candidates_name_length" CHECK (char_length("candidates"."name") BETWEEN 1 AND 100),
	CONSTRAINT "candidates_description_length" CHECK (char_length("candidates"."description") <= 300)
);
--> statement-breakpoint
CREATE TABLE "elections" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"max_selections" integer NOT NULL,
	"status" "election_status" DEFAULT 'DRAFT' NOT NULL,
	"results_visibility" "results_visibility" DEFAULT 'LIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opened_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"finalized_at" timestamp with time zone,
	CONSTRAINT "elections_max_selections_positive" CHECK ("elections"."max_selections" >= 1),
	CONSTRAINT "elections_name_length" CHECK (char_length("elections"."name") BETWEEN 1 AND 120)
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recovery_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"voter_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_by_admin_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "recovery_tokens_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"voter_id" uuid,
	"admin_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sessions_exactly_one_subject" CHECK (("sessions"."voter_id" IS NULL) <> ("sessions"."admin_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "voter_participation" (
	"election_id" integer NOT NULL,
	"voter_id" uuid NOT NULL,
	"submission_key" uuid NOT NULL,
	CONSTRAINT "voter_participation_election_id_voter_id_pk" PRIMARY KEY("election_id","voter_id")
);
--> statement-breakpoint
CREATE TABLE "voters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" text NOT NULL,
	"registration_number" text NOT NULL,
	"registration_number_normalized" text NOT NULL,
	"password_hash" text NOT NULL,
	"eligible" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "voters_registration_number_unique" UNIQUE("registration_number_normalized"),
	CONSTRAINT "voters_full_name_length" CHECK (char_length("voters"."full_name") BETWEEN 1 AND 100),
	CONSTRAINT "voters_registration_number_length" CHECK (char_length("voters"."registration_number_normalized") BETWEEN 1 AND 40)
);
--> statement-breakpoint
ALTER TABLE "ballot_choices" ADD CONSTRAINT "ballot_choices_ballot_fk" FOREIGN KEY ("ballot_id","election_id") REFERENCES "public"."ballots"("id","election_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ballot_choices" ADD CONSTRAINT "ballot_choices_candidate_fk" FOREIGN KEY ("candidate_id","election_id") REFERENCES "public"."candidates"("id","election_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ballots" ADD CONSTRAINT "ballots_election_id_elections_id_fk" FOREIGN KEY ("election_id") REFERENCES "public"."elections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_election_id_elections_id_fk" FOREIGN KEY ("election_id") REFERENCES "public"."elections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_tokens" ADD CONSTRAINT "recovery_tokens_voter_id_voters_id_fk" FOREIGN KEY ("voter_id") REFERENCES "public"."voters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_tokens" ADD CONSTRAINT "recovery_tokens_created_by_admin_id_admin_users_id_fk" FOREIGN KEY ("created_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_voter_id_voters_id_fk" FOREIGN KEY ("voter_id") REFERENCES "public"."voters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_admin_id_admin_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admin_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voter_participation" ADD CONSTRAINT "voter_participation_election_id_elections_id_fk" FOREIGN KEY ("election_id") REFERENCES "public"."elections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voter_participation" ADD CONSTRAINT "voter_participation_voter_id_voters_id_fk" FOREIGN KEY ("voter_id") REFERENCES "public"."voters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_occurred_idx" ON "audit_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "ballot_choices_candidate_idx" ON "ballot_choices" USING btree ("candidate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "candidates_election_name_unique" ON "candidates" USING btree ("election_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "elections_singleton" ON "elections" USING btree ((true));--> statement-breakpoint
CREATE INDEX "recovery_tokens_voter_idx" ON "recovery_tokens" USING btree ("voter_id");--> statement-breakpoint
CREATE INDEX "sessions_voter_idx" ON "sessions" USING btree ("voter_id");--> statement-breakpoint
CREATE INDEX "sessions_admin_idx" ON "sessions" USING btree ("admin_id");