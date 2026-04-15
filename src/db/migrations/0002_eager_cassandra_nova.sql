CREATE TABLE "setting_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"category" text NOT NULL,
	"value" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "setting_values_category_value_unique" UNIQUE("category","value"),
	CONSTRAINT "setting_values_category_check" CHECK ("setting_values"."category" IN ('interaction.type', 'relationship.type'))
);
--> statement-breakpoint
ALTER TABLE "interactions" DROP CONSTRAINT "interactions_type_check";--> statement-breakpoint
ALTER TABLE "relationships" DROP CONSTRAINT "relationships_type_check";
--> statement-breakpoint
INSERT INTO "setting_values" ("category", "value", "label", "sort_order", "is_active") VALUES
	('interaction.type', 'meeting', 'Meeting', 0, true),
	('interaction.type', 'call', 'Call', 1, true),
	('interaction.type', 'message', 'Message', 2, true),
	('interaction.type', 'email', 'Email', 3, true),
	('interaction.type', 'other', 'Other', 4, true),
	('relationship.type', 'friend', 'Friend', 0, true),
	('relationship.type', 'family', 'Family', 1, true),
	('relationship.type', 'colleague', 'Colleague', 2, true),
	('relationship.type', 'acquaintance', 'Acquaintance', 3, true),
	('relationship.type', 'other', 'Other', 4, true)
ON CONFLICT ("category", "value") DO NOTHING;
