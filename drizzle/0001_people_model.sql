ALTER TABLE "users" ALTER COLUMN "role" SET DATA TYPE text;--> statement-breakpoint
-- "member" became "sales_executive". Remap while the column is still text,
-- otherwise the cast back to the new enum fails on every existing row.
UPDATE "users" SET "role" = 'sales_executive' WHERE "role" = 'member';--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'sales_executive'::text;--> statement-breakpoint
DROP TYPE "public"."role";--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('owner', 'manager', 'sales_executive');--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'sales_executive'::"public"."role";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DATA TYPE "public"."role" USING "role"::"public"."role";--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "created_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "admin_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;