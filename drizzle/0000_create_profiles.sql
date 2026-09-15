CREATE TABLE "profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"bio" text,
	"avatar_ref" text,
	"birth_year" integer NOT NULL,
	"gender" text,
	"area" text,
	"pace" integer,
	"volume" integer,
	"experience" text,
	"preferred_distances" jsonb NOT NULL,
	"preferred_run_times" jsonb NOT NULL
);
