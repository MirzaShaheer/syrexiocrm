CREATE TABLE "bid_week_trash" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"week_start" timestamp with time zone NOT NULL,
	"bids" numeric(5, 0) DEFAULT '0' NOT NULL,
	"chats_opened" numeric(5, 0),
	"contracted" numeric(5, 0),
	"closed" numeric(5, 0),
	"withdrawn" numeric(5, 0),
	"entered_by_user_id" uuid,
	"deleted_by_user_id" uuid,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bid_week_trash" ADD CONSTRAINT "bid_week_trash_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_week_trash" ADD CONSTRAINT "bid_week_trash_entered_by_user_id_users_id_fk" FOREIGN KEY ("entered_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_week_trash" ADD CONSTRAINT "bid_week_trash_deleted_by_user_id_users_id_fk" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bid_week_trash_deleted_idx" ON "bid_week_trash" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "bid_week_trash_slot_idx" ON "bid_week_trash" USING btree ("account_id","week_start");