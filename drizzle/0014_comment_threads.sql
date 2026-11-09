CREATE TABLE "comment_votes" (
	"user_id" integer NOT NULL,
	"comment_id" integer NOT NULL,
	"value" smallint NOT NULL,
	CONSTRAINT "comment_votes_user_id_comment_id_pk" PRIMARY KEY("user_id","comment_id")
);
--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "parent_id" integer;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "reply_to_id" integer;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "depth" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD COLUMN "replies" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD COLUMN "mentions" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "comment_votes" ADD CONSTRAINT "comment_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_votes" ADD CONSTRAINT "comment_votes_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_parent_id_comments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_reply_to_id_comments_id_fk" FOREIGN KEY ("reply_to_id") REFERENCES "public"."comments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comments_media_created_idx" ON "comments" USING btree ("media_id","created_at","id");--> statement-breakpoint
CREATE INDEX "comments_parent_idx" ON "comments" USING btree ("parent_id");--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_depth_check" CHECK ("comments"."depth" BETWEEN 1 AND 3);--> statement-breakpoint
CREATE OR REPLACE FUNCTION mention_text(t text) RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE
	m text[];
	result text := t;
BEGIN
	FOR m IN SELECT regexp_matches(t, '@\[u:([0-9A-Za-z]{12})\]', 'g') LOOP
		result := replace(result, '@[u:' || m[1] || ']', '@' || coalesce(
			(SELECT coalesce(display_name, username) FROM users WHERE public_id = m[1]),
			'unknown member'));
	END LOOP;
	RETURN result;
END $$;
