ALTER TABLE "profiles" ADD COLUMN "id" uuid PRIMARY KEY NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "name" text NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "bio" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "pace_min" double precision NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "pace_max" double precision NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "experience" text NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "area" text NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "latitude" double precision NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "longitude" double precision NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "availability" text NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "usual_distance" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "gear" jsonb;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "photo_ref" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "hidden_fields" jsonb DEFAULT '[]'::jsonb NOT NULL;