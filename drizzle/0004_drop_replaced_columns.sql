ALTER TABLE "profiles" DROP CONSTRAINT "pace_range_has_both_ends";--> statement-breakpoint
ALTER TABLE "profiles" DROP COLUMN "user_id";--> statement-breakpoint
ALTER TABLE "profiles" DROP COLUMN "display_name";--> statement-breakpoint
ALTER TABLE "profiles" DROP COLUMN "bio";--> statement-breakpoint
ALTER TABLE "profiles" DROP COLUMN "avatar_ref";--> statement-breakpoint
ALTER TABLE "profiles" DROP COLUMN "birth_year";--> statement-breakpoint
ALTER TABLE "profiles" DROP COLUMN "gender";--> statement-breakpoint
ALTER TABLE "profiles" DROP COLUMN "area_latitude";--> statement-breakpoint
ALTER TABLE "profiles" DROP COLUMN "area_longitude";--> statement-breakpoint
ALTER TABLE "profiles" DROP COLUMN "pace_fastest";--> statement-breakpoint
ALTER TABLE "profiles" DROP COLUMN "pace_slowest";--> statement-breakpoint
ALTER TABLE "profiles" DROP COLUMN "usual_distance";--> statement-breakpoint
ALTER TABLE "profiles" DROP COLUMN "experience";--> statement-breakpoint
ALTER TABLE "profiles" DROP COLUMN "preferred_run_times";--> statement-breakpoint
ALTER TABLE "profiles" DROP COLUMN "gear";--> statement-breakpoint
ALTER TABLE "profiles" DROP COLUMN "hidden_fields";