CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX "media_title_trgm_idx" ON "media" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "comments_text_trgm_idx" ON "comments" USING gin ("text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "quotes_text_trgm_idx" ON "quotes" USING gin ("text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "tags_name_trgm_idx" ON "tags" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "users_name_trgm_idx" ON "users" USING gin ((coalesce("display_name", "username")) gin_trgm_ops);
