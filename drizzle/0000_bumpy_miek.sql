CREATE TYPE "public"."connection_state" AS ENUM('disconnected', 'connected', 'needs_reconnect');--> statement-breakpoint
CREATE TYPE "public"."contract_status" AS ENUM('active', 'paused', 'ended');--> statement-breakpoint
CREATE TYPE "public"."contract_type" AS ENUM('fixed', 'hourly');--> statement-breakpoint
CREATE TYPE "public"."market" AS ENUM('us', 'pk');--> statement-breakpoint
CREATE TYPE "public"."milestone_status" AS ENUM('pending', 'submitted', 'approved', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."niche" AS ENUM('web_development', 'ebook_design', 'graphic_design');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('owner', 'manager', 'member');--> statement-breakpoint
CREATE TYPE "public"."sync_run_status" AS ENUM('running', 'success', 'error');--> statement-breakpoint
CREATE TYPE "public"."sync_trigger" AS ENUM('cron', 'webhook', 'manual');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"market" "market" NOT NULL,
	"niche" "niche" NOT NULL,
	"upwork_org_ref" text,
	"access_token" text,
	"refresh_token" text,
	"token_expires_at" timestamp with time zone,
	"connection_state" "connection_state" DEFAULT 'disconnected' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_sync_error" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_label_unique" UNIQUE("label")
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"rule_key" text NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"notified_at" timestamp with time zone,
	"owner_user_id_at_open" uuid
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"country" text,
	"upwork_client_ref" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"upwork_contract_id" text NOT NULL,
	"title" text NOT NULL,
	"type" "contract_type" NOT NULL,
	"value" numeric(12, 2),
	"currency" text DEFAULT 'USD' NOT NULL,
	"status" "contract_status" DEFAULT 'active' NOT NULL,
	"owner_user_id" uuid,
	"stage" text NOT NULL,
	"next_action_text" text,
	"next_action_due_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"last_client_message_at" timestamp with time zone,
	"last_team_message_at" timestamp with time zone,
	"last_update_at" timestamp with time zone,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"type" text NOT NULL,
	"actor" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dedupe_key" text
);
--> statement-breakpoint
CREATE TABLE "milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"upwork_milestone_id" text NOT NULL,
	"title" text NOT NULL,
	"amount" numeric(12, 2),
	"due_at" timestamp with time zone,
	"status" "milestone_status" DEFAULT 'pending' NOT NULL,
	"submitted_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid,
	"trigger" "sync_trigger" NOT NULL,
	"status" "sync_run_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"contracts_seen" numeric(6, 0) DEFAULT '0' NOT NULL,
	"contracts_created" numeric(6, 0) DEFAULT '0' NOT NULL,
	"contracts_updated" numeric(6, 0) DEFAULT '0' NOT NULL,
	"contracts_closed" numeric(6, 0) DEFAULT '0' NOT NULL,
	"request_log" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "role" DEFAULT 'member' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_owner_user_id_at_open_users_id_fk" FOREIGN KEY ("owner_user_id_at_open") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "updates" ADD CONSTRAINT "updates_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "updates" ADD CONSTRAINT "updates_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alerts_open_unique_idx" ON "alerts" USING btree ("contract_id","rule_key") WHERE "alerts"."resolved_at" is null;--> statement-breakpoint
CREATE INDEX "alerts_contract_idx" ON "alerts" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "alerts_rule_idx" ON "alerts" USING btree ("rule_key","opened_at");--> statement-breakpoint
CREATE INDEX "alerts_unnotified_idx" ON "alerts" USING btree ("notified_at");--> statement-breakpoint
CREATE UNIQUE INDEX "clients_upwork_ref_idx" ON "clients" USING btree ("upwork_client_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "contracts_upwork_id_idx" ON "contracts" USING btree ("upwork_contract_id");--> statement-breakpoint
CREATE INDEX "contracts_account_idx" ON "contracts" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "contracts_owner_idx" ON "contracts" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "contracts_status_idx" ON "contracts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "contracts_next_action_due_idx" ON "contracts" USING btree ("next_action_due_at");--> statement-breakpoint
CREATE INDEX "events_contract_idx" ON "events" USING btree ("contract_id","occurred_at");--> statement-breakpoint
CREATE INDEX "events_type_idx" ON "events" USING btree ("type");--> statement-breakpoint
CREATE UNIQUE INDEX "events_dedupe_idx" ON "events" USING btree ("dedupe_key");--> statement-breakpoint
CREATE UNIQUE INDEX "milestones_upwork_id_idx" ON "milestones" USING btree ("upwork_milestone_id");--> statement-breakpoint
CREATE INDEX "milestones_contract_idx" ON "milestones" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "milestones_due_idx" ON "milestones" USING btree ("due_at","status");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sync_runs_account_idx" ON "sync_runs" USING btree ("account_id","started_at");--> statement-breakpoint
CREATE INDEX "updates_contract_idx" ON "updates" USING btree ("contract_id","created_at");--> statement-breakpoint
CREATE INDEX "updates_author_idx" ON "updates" USING btree ("author_user_id","created_at");