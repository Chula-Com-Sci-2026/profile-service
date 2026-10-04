ALTER TABLE "profiles" ADD COLUMN "area_latitude" double precision NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "area_longitude" double precision NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" DROP COLUMN "area";