import { sql } from 'drizzle-orm'
import { bigint, doublePrecision, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import type { ProfileUpdatedEvent } from './profile-published-language.ts'

/**
 * One table, one row per profile — domain.md §3's aggregate, stored as one unit.
 *
 * Each column is its field's name in snake_case, holding the value the wire carries: `pace_min` is
 * decimal minutes per kilometre, `experience` is `Beginner`, an unset field is SQL `NULL` — gear
 * included. `text` for the unions rather than a Postgres enum: altering an enum is a migration
 * where altering a rule is not. `double precision` for the pace and the point, which round-trips
 * a JavaScript number exactly. The table enforces shape and the primary key; every §4 rule lives in
 * TypeScript, which is why the mapper re-validates on the way in.
 */
export const profiles = pgTable('profiles', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  bio: text('bio'),
  paceMin: doublePrecision('pace_min').notNull(),
  paceMax: doublePrecision('pace_max').notNull(),
  experience: text('experience').notNull(),
  area: text('area').notNull(),
  latitude: doublePrecision('latitude').notNull(),
  longitude: doublePrecision('longitude').notNull(),
  availability: text('availability').notNull(),
  usualDistance: text('usual_distance'),
  gear: jsonb('gear').$type<string[]>(),
  photoRef: text('photo_ref'),
  hiddenFields: jsonb('hidden_fields').$type<string[]>().notNull().default([]),
  // domain.md §5: rises by one with every change, and a write is conditional on it.
  revision: integer('revision').notNull(),
})

export type ProfileRow = typeof profiles.$inferSelect
export type ProfileInsert = typeof profiles.$inferInsert

/**
 * The transactional outbox: one row per event, written in the same transaction as the change it
 * tells of, and sent by the relay afterwards (build_plan's **Profile events**).
 *
 * `sequence` is the order rows are sent in, oldest first. `payload` is the whole envelope, exactly
 * as it goes out. `published_at` stays null until the broker has the event; sent rows keep it, and
 * nothing deletes them. The partial index covers the one question the relay asks — the oldest row
 * still waiting — so it stays cheap however many sent rows pile up.
 */
export const outbox = pgTable(
  'outbox',
  {
    sequence: bigint('sequence', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    eventId: uuid('event_id').notNull().unique(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').$type<ProfileUpdatedEvent>().notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (table) => [index('outbox_unsent').on(table.sequence).where(sql`published_at IS NULL`)],
)
