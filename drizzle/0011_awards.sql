CREATE TABLE "awards" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text DEFAULT 'meme_of_the_month' NOT NULL,
	"month" date NOT NULL,
	"media_id" integer,
	"uploader_id" integer,
	"title" text NOT NULL,
	"score" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "awards" ADD CONSTRAINT "awards_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "awards" ADD CONSTRAINT "awards_uploader_id_users_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "awards_kind_month_idx" ON "awards" USING btree ("kind","month");