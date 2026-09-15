CREATE TABLE "subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"telegram_user_id" integer NOT NULL,
	"country" varchar(2) NOT NULL,
	"brand" varchar(20) NOT NULL,
	"plan_id" varchar(64) NOT NULL,
	"memory" varchar(64) NOT NULL,
	"disk" varchar(64) NOT NULL,
	"price" varchar(32) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_user" (
	"id" serial PRIMARY KEY NOT NULL,
	"chat_id" bigint NOT NULL,
	"notifications_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_user_chat_id_unique" UNIQUE("chat_id")
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_telegram_user_id_telegram_user_id_fk" FOREIGN KEY ("telegram_user_id") REFERENCES "public"."telegram_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_sub" ON "subscriptions" USING btree ("telegram_user_id","country","brand","plan_id");--> statement-breakpoint
CREATE INDEX "poll_idx" ON "subscriptions" USING btree ("country","brand");