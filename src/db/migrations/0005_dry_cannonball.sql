-- B6 (ADR 0004 §4). B5 deferred this: `owner_id` could not be NOT NULL until
-- the write path had a principal to stamp it from. It does now, so the
-- invariant moves into the database.
--
-- The four UPDATEs below are NOT generated — they are the same deterministic,
-- idempotent backfill `0004_short_newton_destine.sql` ran, repeated here for
-- the rows that could have been written in the B5..B6 window, when inserts
-- still left `owner_id` NULL. Owner = the LOCAL ADMIN (the `users` row with no
-- `household_members` row, B4's definition of a locally authored account),
-- because in that window every write still arrived through the single local
-- account. Without this, upgrading a deployment that ran a B5 build would fail
-- on the SET NOT NULL below; with it, the upgrade carries those rows over.
--
-- If a deployment somehow has unowned rows and NO local account, the subquery
-- yields NULL and the SET NOT NULL fails loudly. That is the correct outcome:
-- inventing an owner for a row nobody can be shown to have written is exactly
-- the mislabelling B5 refused to do.
UPDATE "people" SET "owner_id" = (
	SELECT "u"."id" FROM "users" "u"
	WHERE NOT EXISTS (SELECT 1 FROM "household_members" "hm" WHERE "hm"."user_id" = "u"."id")
	ORDER BY "u"."created_at", "u"."id"
	LIMIT 1
) WHERE "owner_id" IS NULL;--> statement-breakpoint
UPDATE "interactions" SET "owner_id" = (
	SELECT "u"."id" FROM "users" "u"
	WHERE NOT EXISTS (SELECT 1 FROM "household_members" "hm" WHERE "hm"."user_id" = "u"."id")
	ORDER BY "u"."created_at", "u"."id"
	LIMIT 1
) WHERE "owner_id" IS NULL;--> statement-breakpoint
UPDATE "reminders" SET "owner_id" = (
	SELECT "u"."id" FROM "users" "u"
	WHERE NOT EXISTS (SELECT 1 FROM "household_members" "hm" WHERE "hm"."user_id" = "u"."id")
	ORDER BY "u"."created_at", "u"."id"
	LIMIT 1
) WHERE "owner_id" IS NULL;--> statement-breakpoint
UPDATE "relationships" SET "owner_id" = (
	SELECT "u"."id" FROM "users" "u"
	WHERE NOT EXISTS (SELECT 1 FROM "household_members" "hm" WHERE "hm"."user_id" = "u"."id")
	ORDER BY "u"."created_at", "u"."id"
	LIMIT 1
) WHERE "owner_id" IS NULL;--> statement-breakpoint
ALTER TABLE "people" ALTER COLUMN "owner_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "interactions" ALTER COLUMN "owner_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "reminders" ALTER COLUMN "owner_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "relationships" ALTER COLUMN "owner_id" SET NOT NULL;
