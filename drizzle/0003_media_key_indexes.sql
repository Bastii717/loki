CREATE INDEX "media_object_key_idx" ON "media" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "media_thumb_key_idx" ON "media" USING btree ("thumb_key");