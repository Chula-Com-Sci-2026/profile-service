import { sql } from 'drizzle-orm'
import { check, doublePrecision, integer, jsonb, pgTable, text } from 'drizzle-orm/pg-core'

/**
 * One table, one row per profile — domain.md §3's aggregate, stored as one unit.
 *
 * `text` for the unions rather than a Postgres enum: altering an enum is a migration where
 * altering a check is not. `double precision` for the area, which round-trips a JavaScript
 * number exactly. The table enforces shape and the primary key; every §4 rule lives in
 * TypeScript, which is why the mapper re-validates on the way in. Half a pace range is shape,
 * so the table refuses it; which end is faster is §4's.
 */
export const profiles = pgTable(
  'profiles',
  {
    userId: text('user_id').primaryKey(),
    displayName: text('display_name').notNull(),
    bio: text('bio'),
    avatarRef: text('avatar_ref'),
    birthYear: integer('birth_year'),
    gender: text('gender'),
    areaLatitude: doublePrecision('area_latitude').notNull(),
    areaLongitude: doublePrecision('area_longitude').notNull(),
    paceFastest: integer('pace_fastest'),
    paceSlowest: integer('pace_slowest'),
    usualDistance: integer('usual_distance'),
    experience: text('experience'),
    // Sets are NOT NULL with no third state: unset is `[]`, never null.
    preferredRunTimes: jsonb('preferred_run_times').$type<StoredRunTime[]>().notNull(),
    gear: jsonb('gear').$type<string[]>().notNull().default([]),
    hiddenFields: jsonb('hidden_fields').$type<string[]>().notNull().default([]),
  },
  (table) => [
    check('pace_range_has_both_ends', sql`(${table.paceFastest} IS NULL) = (${table.paceSlowest} IS NULL)`),
  ],
)

export type StoredRunTime = { dayOfWeek: string; timeOfDay: string }

export type ProfileRow = typeof profiles.$inferSelect
export type ProfileInsert = typeof profiles.$inferInsert
