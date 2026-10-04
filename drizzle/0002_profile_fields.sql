-- A runner's single pace becomes a range of zero width; it must be copied before "pace" is dropped.
ALTER TABLE "profiles" ALTER COLUMN "birth_year" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "pace_fastest" integer;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "pace_slowest" integer;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "usual_distance" integer;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "gear" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "profiles" SET "pace_fastest" = "pace", "pace_slowest" = "pace";--> statement-breakpoint
ALTER TABLE "profiles" DROP COLUMN "pace";--> statement-breakpoint
ALTER TABLE "profiles" DROP COLUMN "volume";--> statement-breakpoint
ALTER TABLE "profiles" DROP COLUMN "preferred_distances";--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "pace_range_has_both_ends" CHECK (("profiles"."pace_fastest" IS NULL) = ("profiles"."pace_slowest" IS NULL));