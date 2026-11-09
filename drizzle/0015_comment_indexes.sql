CREATE INDEX "comment_votes_comment_idx" ON "comment_votes" USING btree ("comment_id");--> statement-breakpoint
CREATE INDEX "comments_reply_to_idx" ON "comments" USING btree ("reply_to_id");