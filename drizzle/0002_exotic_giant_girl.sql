DROP INDEX "uniq_sub";--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_sub" ON "subscriptions" USING btree ("telegram_user_id","country","brand","plan_id","memory","disk");