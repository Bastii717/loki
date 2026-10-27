CREATE TABLE "season_settings" (
	"id" integer PRIMARY KEY NOT NULL,
	"mode" text DEFAULT 'auto' NOT NULL,
	"theme" text,
	"until" timestamp with time zone,
	"updated_by" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "season_settings" ADD CONSTRAINT "season_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;