CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN "snoozed_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN "snooze_reason" text;--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN "snoozed_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "timezone" text;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notes_contract_idx" ON "notes" USING btree ("contract_id","created_at");--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_snoozed_by_user_id_users_id_fk" FOREIGN KEY ("snoozed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alerts_snoozed_idx" ON "alerts" USING btree ("snoozed_until");