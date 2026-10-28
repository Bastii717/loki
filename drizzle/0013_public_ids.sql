CREATE EXTENSION IF NOT EXISTS pgcrypto;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public_id() RETURNS text LANGUAGE sql VOLATILE SET search_path = public, pg_temp AS $$
  SELECT string_agg(substr('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', (get_byte(b, i) % 62) + 1, 1), '' ORDER BY i)
  FROM gen_random_bytes(12) AS b, generate_series(0, 11) AS i
$$;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "public_id" text DEFAULT public_id() NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "public_id" text DEFAULT public_id() NOT NULL;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "public_id" text DEFAULT public_id() NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "public_id" text DEFAULT public_id() NOT NULL;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "public_id" text DEFAULT public_id() NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "media_public_id_idx" ON "media" USING btree ("public_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_public_id_idx" ON "users" USING btree ("public_id");--> statement-breakpoint
CREATE UNIQUE INDEX "comments_public_id_idx" ON "comments" USING btree ("public_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_public_id_idx" ON "quotes" USING btree ("public_id");--> statement-breakpoint
CREATE UNIQUE INDEX "templates_public_id_idx" ON "templates" USING btree ("public_id");
