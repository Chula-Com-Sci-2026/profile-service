import { integer, jsonb, pgTable, text } from 'drizzle-orm/pg-core'

/**
 * One table, one row per profile — domain.md §3's aggregate, stored as one unit.
 *
 * `text` for the unions rather than a Postgres enum: the `area` list is expected to change,
 * and altering an enum is a migration where altering a check is not. The table enforces
 * shape and the primary key; every §4 rule lives in TypeScript, which is why the mapper
 * re-validates on the way in.
 */
export const profiles = pgTable('profiles', {
  userId: text('user_id').primaryKey(),
  displayName: text('display_name').notNull(),
  bio: text('bio'),
  avatarRef: text('avatar_ref'),
  birthYear: integer('birth_year').notNull(),
  gender: text('gender'),
  area: text('area'),
  pace: integer('pace'),
  volume: integer('volume'),
  experience: text('experience'),
  // Sets are NOT NULL with no third state: unset is `[]`, never null.
  preferredDistances: jsonb('preferred_distances').$type<string[]>().notNull(),
  preferredRunTimes: jsonb('preferred_run_times').$type<StoredRunTime[]>().notNull(),
})

export type StoredRunTime = { dayOfWeek: string; timeOfDay: string }

export type ProfileRow = typeof profiles.$inferSelect
export type ProfileInsert = typeof profiles.$inferInsert
