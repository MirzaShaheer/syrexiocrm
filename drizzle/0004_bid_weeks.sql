CREATE TABLE "bid_weeks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"week_start" timestamp with time zone NOT NULL,
	"bids" numeric(5, 0) DEFAULT '0' NOT NULL,
	"connects_spent" numeric(6, 0),
	"entered_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bid_weeks" ADD CONSTRAINT "bid_weeks_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_weeks" ADD CONSTRAINT "bid_weeks_entered_by_user_id_users_id_fk" FOREIGN KEY ("entered_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bid_weeks_account_week_idx" ON "bid_weeks" USING btree ("account_id","week_start");--> statement-breakpoint
CREATE INDEX "bid_weeks_week_idx" ON "bid_weeks" USING btree ("week_start");