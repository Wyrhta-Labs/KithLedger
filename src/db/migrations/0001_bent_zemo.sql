ALTER TABLE "reminders" ADD COLUMN "kind" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "reminders" ADD COLUMN "is_hidden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "reminders_birthday_person_unique" ON "reminders" USING btree ("person_id") WHERE "reminders"."kind" = 'birthday';--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_kind_check" CHECK ("reminders"."kind" IN ('manual', 'birthday'));