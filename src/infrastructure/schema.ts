import { doublePrecision, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core'

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
})

export type ProfileRow = typeof profiles.$inferSelect
export type ProfileInsert = typeof profiles.$inferInsert
