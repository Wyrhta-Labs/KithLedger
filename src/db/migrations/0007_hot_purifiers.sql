-- B9 (ADR 0004 §4). `updated_by` — WHO last wrote each row — added to the four
-- domain tables. See `src/db/schema/visibility.ts` for the column's semantics
-- and for why its ON DELETE is SET NULL where `owner_id` is RESTRICT.
--
-- BACKFILL: DELIBERATELY NONE. `0004_*.sql` and `0005_*.sql` both carry a
-- hand-written, deterministic, idempotent UPDATE because `owner_id` had to end
-- up NOT NULL and a wrong-but-present owner is still classifiable by the scope
-- predicate. Neither condition holds here, and the honest value for every
-- pre-existing row is "not recorded" — which is what ADD COLUMN has already
-- written. Concretely, every candidate backfill asserts something false:
--
--  * `updated_by = owner_id` asserts that the owner was the last writer. That
--    is exactly the claim this column exists to be able to DISPROVE: since B6,
--    content edits follow read scope, so any member a `shared` item reaches —
--    and every member, for a `household` item — can have been the last writer.
--    Stamping the owner would manufacture a clean provenance record for
--    precisely the rows whose provenance is in question.
--  * `updated_by = <the local admin>` (the value 0004/0005 chose for
--    `owner_id`) rested on "only the local account could reach a write endpoint
--    before member tokens existed". That argument expired: B4 landed member
--    tokens and B6 landed member writes, so the rows in this table span two
--    eras and no single statement can tell them apart.
--  * Restricting a backfill to rows with `updated_at = created_at` (never
--    edited since insert, so the writer IS the creator) looks safe and is not:
--    `completeReminder` inserts the successor of a recurring reminder with the
--    ORIGINAL's `owner_id` and a fresh pair of timestamps, so for that row the
--    creator is whoever ticked the box and the owner is somebody else — the
--    one case where creator and owner provably differ is the one such a
--    backfill would silently mislabel.
--
-- NULL therefore means "not recorded", it means the same thing for a pre-B9
-- row as for a row whose writer has since been offboarded (ON DELETE SET
-- NULL), and no reader has to know which era a row came from. An UPDATE that
-- wrote any of the values above would not be a backfill; it would be an
-- invented audit trail, and an invented audit trail is worse than none.

ALTER TABLE "people" ADD COLUMN "updated_by" uuid;--> statement-breakpoint
ALTER TABLE "interactions" ADD COLUMN "updated_by" uuid;--> statement-breakpoint
ALTER TABLE "reminders" ADD COLUMN "updated_by" uuid;--> statement-breakpoint
ALTER TABLE "relationships" ADD COLUMN "updated_by" uuid;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interactions" ADD CONSTRAINT "interactions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;