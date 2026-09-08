CREATE TABLE "bot_cursors" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_prompts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" text NOT NULL,
	"message_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"contract_id" uuid,
	"account_id" uuid,
	"alert_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"answered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN "last_nudged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN "nudge_count" numeric(4, 0) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "keyboard" jsonb;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "message_id" text;--> statement-breakpoint
ALTER TABLE "bot_prompts" ADD CONSTRAINT "bot_prompts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_prompts" ADD CONSTRAINT "bot_prompts_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_prompts" ADD CONSTRAINT "bot_prompts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_prompts" ADD CONSTRAINT "bot_prompts_alert_id_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."alerts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bot_prompts_message_idx" ON "bot_prompts" USING btree ("chat_id","message_id");--> statement-breakpoint
CREATE INDEX "bot_prompts_expiry_idx" ON "bot_prompts" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "alerts_nudge_idx" ON "alerts" USING btree ("last_nudged_at");