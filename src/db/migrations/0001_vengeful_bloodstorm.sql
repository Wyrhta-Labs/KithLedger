CREATE TYPE "public"."user_role" AS ENUM('admin', 'adult', 'child');--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"handle" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'adult' NOT NULL,
	"display_name" text,
	"avatar_color" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_handle_unique" UNIQUE("handle")
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "user_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "prefix" text NOT NULL;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" DROP COLUMN "key_prefix";--> statement-breakpoint
ALTER TABLE "api_keys" DROP COLUMN "expires_at";--> statement-breakpoint
ALTER TABLE "api_keys" DROP COLUMN "is_active";--> statement-breakpoint
ALTER TABLE "api_keys" DROP COLUMN "scopes";