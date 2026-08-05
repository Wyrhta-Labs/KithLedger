ALTER TABLE "reminders" ADD COLUMN "kind" text DEFAULT 'generic' NOT NULL;--> statement-breakpoint
ALTER TABLE "reminders" ADD COLUMN "lead_days" integer;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_kind_check" CHECK ("reminders"."kind" IN ('generic', 'birthday'));