CREATE TABLE "outbox" (
	"sequence" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "outbox_sequence_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"event_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "outbox_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE INDEX "outbox_unsent" ON "outbox" USING btree ("sequence") WHERE published_at IS NULL;