ALTER TABLE "contracts" ADD COLUMN "is_historical" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "won_month" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "outcome" text;