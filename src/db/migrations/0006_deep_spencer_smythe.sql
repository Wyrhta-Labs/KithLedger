CREATE TABLE "api_key_credentials" (
	"key_id" uuid PRIMARY KEY NOT NULL,
	"kind" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_key_credentials_kind_check" CHECK ("api_key_credentials"."kind" IN ('member', 'household', 'ops'))
);
--> statement-breakpoint
ALTER TABLE "api_key_credentials" ADD CONSTRAINT "api_key_credentials_key_id_api_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- BACKFILL (hand-written; drizzle-kit generates DDL, not data migrations).
--
-- B8 (ADR 0004 §2) refuses a `kl_` key that has no row here, so that losing a
-- row narrows a credential to nothing instead of silently widening it. Every
-- key that existed before this migration was issued under the pre-B8 rules,
-- where the only thing a key could be was a member principal — so that is what
-- they are recorded as, explicitly, rather than being read as one by default.
-- Without this, upgrading a live deployment would kill every existing key
-- (including `KITHLEDGER_MCP_API_KEY` and today's Heorth `KITH_API_KEY`) on the
-- first request after the deploy.
--
-- Idempotent: ON CONFLICT DO NOTHING, so re-running never overwrites a kind an
-- operator has since chosen.
INSERT INTO "api_key_credentials" ("key_id", "kind")
SELECT "id", 'member' FROM "api_keys"
ON CONFLICT ("key_id") DO NOTHING;
