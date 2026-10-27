ALTER TABLE "users" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "display_name_key" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "display_name_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "display_name_set_by" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_key" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_thumb_key" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "motto" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_display_name_set_by_users_id_fk" FOREIGN KEY ("display_name_set_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "users_display_name_key_idx" ON "users" USING btree ("display_name_key") WHERE "users"."display_name_key" IS NOT NULL;