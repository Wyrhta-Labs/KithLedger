CREATE TABLE "interaction_shares" (
	"interaction_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interaction_shares_interaction_id_member_id_pk" PRIMARY KEY("interaction_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "person_shares" (
	"person_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_shares_person_id_member_id_pk" PRIMARY KEY("person_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "relationship_shares" (
	"relationship_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "relationship_shares_relationship_id_member_id_pk" PRIMARY KEY("relationship_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "reminder_shares" (
	"reminder_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reminder_shares_reminder_id_member_id_pk" PRIMARY KEY("reminder_id","member_id")
);
--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "visibility" text DEFAULT 'household' NOT NULL;--> statement-breakpoint
ALTER TABLE "interactions" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "interactions" ADD COLUMN "visibility" text DEFAULT 'household' NOT NULL;--> statement-breakpoint
ALTER TABLE "reminders" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "reminders" ADD COLUMN "visibility" text DEFAULT 'household' NOT NULL;--> statement-breakpoint
ALTER TABLE "relationships" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "relationships" ADD COLUMN "visibility" text DEFAULT 'household' NOT NULL;--> statement-breakpoint

-- BACKFILL (hand-written; drizzle-kit generates DDL, not data migrations).
--
-- `visibility` needs no UPDATE: ADD COLUMN ... DEFAULT 'household' NOT NULL
-- has already stamped every pre-existing row `household`. That is the
-- behaviour-preserving choice and it is deliberate. KithLedger has been a
-- single-account deployment in which every row was readable by every caller,
-- so once B6 turns enforcement on, `household` is the only value under which
-- today's rows keep behaving exactly as they do today: every current member
-- and every future one still sees them, and the always-on household service
-- principal (ADR 0004 §2.2) still sees them. `private` would make the entire
-- existing dataset vanish from the UI the moment B6 lands; `shared` with an
-- empty set is `private` wearing a hat; `shared` enumerating today's members
-- is the materialised-share-list anti-pattern ADR 0004 §1 rejects outright --
-- it would freeze the audience as of migration time and quietly exclude every
-- member added afterwards.
--
-- `owner_id` is backfilled to the LOCAL ADMIN: the `users` row with no
-- `household_members` row, which is precisely B4's definition of a locally
-- authored account as opposed to a Heorth-authored member. Every pre-existing
-- row was in fact created through that account -- it is the only credential
-- that could reach a write endpoint before member tokens existed -- so this
-- records the truth rather than picking a plausible owner. Choosing a member
-- instead would hand them ADR 0004 §4 mutation rights over data they never
-- authored.
--
-- Ties are broken by (created_at, id) so the statement is deterministic, and
-- it is scoped `WHERE owner_id IS NULL` so it is idempotent. On a fresh
-- database both the domain tables and `users` are empty and every statement
-- here is a no-op -- the seeded admin does not exist yet at migrate() time
-- (src/index.ts runs migrations BEFORE seedAdmin), which is exactly why this
-- must be a backfill of existing rows and never a default.
--
-- If a deployment somehow holds domain rows but no local account, the
-- subquery yields NULL and those rows stay unowned rather than being assigned
-- to an arbitrary member. They are `household`, so no read behaviour changes;
-- B9's offboarding flow is where an unowned item gets an owner.
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
ALTER TABLE "interaction_shares" ADD CONSTRAINT "interaction_shares_interaction_id_interactions_id_fk" FOREIGN KEY ("interaction_id") REFERENCES "public"."interactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interaction_shares" ADD CONSTRAINT "interaction_shares_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_shares" ADD CONSTRAINT "person_shares_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_shares" ADD CONSTRAINT "person_shares_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship_shares" ADD CONSTRAINT "relationship_shares_relationship_id_relationships_id_fk" FOREIGN KEY ("relationship_id") REFERENCES "public"."relationships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship_shares" ADD CONSTRAINT "relationship_shares_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_shares" ADD CONSTRAINT "reminder_shares_reminder_id_reminders_id_fk" FOREIGN KEY ("reminder_id") REFERENCES "public"."reminders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_shares" ADD CONSTRAINT "reminder_shares_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "interaction_shares_member_id_idx" ON "interaction_shares" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "person_shares_member_id_idx" ON "person_shares" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "relationship_shares_member_id_idx" ON "relationship_shares" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "reminder_shares_member_id_idx" ON "reminder_shares" USING btree ("member_id");--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interactions" ADD CONSTRAINT "interactions_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "people_owner_id_idx" ON "people" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "interactions_owner_id_idx" ON "interactions" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "reminders_owner_id_idx" ON "reminders" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "relationships_owner_id_idx" ON "relationships" USING btree ("owner_id");--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_visibility_check" CHECK ("people"."visibility" IN ('private', 'shared', 'household'));--> statement-breakpoint
ALTER TABLE "interactions" ADD CONSTRAINT "interactions_visibility_check" CHECK ("interactions"."visibility" IN ('private', 'shared', 'household'));--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_visibility_check" CHECK ("reminders"."visibility" IN ('private', 'shared', 'household'));--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_visibility_check" CHECK ("relationships"."visibility" IN ('private', 'shared', 'household'));