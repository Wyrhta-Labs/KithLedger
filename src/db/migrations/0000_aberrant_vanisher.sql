CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"birthday" date,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"notes" text,
	"avatar_url" text,
	CONSTRAINT "people_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "interactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"person_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"type" text NOT NULL,
	"channel" text,
	"notes" text,
	"sentiment" text,
	CONSTRAINT "interactions_type_check" CHECK ("interactions"."type" IN ('meeting', 'call', 'message', 'email', 'other')),
	CONSTRAINT "interactions_sentiment_check" CHECK ("interactions"."sentiment" IS NULL OR "interactions"."sentiment" IN ('positive', 'neutral', 'negative'))
);
--> statement-breakpoint
CREATE TABLE "reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"person_id" uuid NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"snoozed_until" timestamp with time zone,
	"recurrence" text,
	CONSTRAINT "reminders_status_check" CHECK ("reminders"."status" IN ('pending', 'done', 'snoozed', 'dismissed'))
);
--> statement-breakpoint
CREATE TABLE "relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"from_person_id" uuid NOT NULL,
	"to_person_id" uuid NOT NULL,
	"type" text NOT NULL,
	"label" text,
	"is_mutual" boolean DEFAULT true NOT NULL,
	"notes" text,
	CONSTRAINT "relationships_from_person_id_to_person_id_unique" UNIQUE("from_person_id","to_person_id"),
	CONSTRAINT "relationships_type_check" CHECK ("relationships"."type" IN ('friend', 'family', 'colleague', 'acquaintance', 'other')),
	CONSTRAINT "relationships_no_self_link" CHECK ("relationships"."from_person_id" <> "relationships"."to_person_id")
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"expires_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
ALTER TABLE "interactions" ADD CONSTRAINT "interactions_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_from_person_id_people_id_fk" FOREIGN KEY ("from_person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_to_person_id_people_id_fk" FOREIGN KEY ("to_person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;