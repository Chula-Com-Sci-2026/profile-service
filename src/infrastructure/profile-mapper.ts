import { InvalidProfileFieldError } from '../domain/errors.ts'
import { toExperience } from '../domain/experience.ts'
import { toHiddenField } from '../domain/hidden-field.ts'
import { Profile } from '../domain/profile.ts'
import { toUsualDistance } from '../domain/usual-distance.ts'
import type { ProfileInsert, ProfileRow } from './schema.ts'

/**
 * Row ↔ domain. Nothing is renamed and no value converted: the schema declaration names each
 * column for its field, and the column holds the value the wire carries.
 *
 * Row → domain is still a boundary. The table enforces shape and the primary key and nothing else —
 * every §4 rule lives in TypeScript — so a value read back is validated as if it arrived from a
 * stranger. A row written by an older version of this code, or by hand, fails here rather than
 * becoming a Profile that breaks its own rules.
 */

/**
 * `jsonb` accepts any JSON, and `$type<string[]>()` is an unchecked assertion — `'"marathon"'::jsonb`
 * and, for `hidden_fields`, `'null'::jsonb` both satisfy the column. Check the shape here, or a
 * hand-written row leaves as a TypeError and the edge turns a bad row into a 500 instead of a 4xx.
 */
function asTexts(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new InvalidProfileFieldError(field, 'is not stored as an array')
  return value.map((member: unknown) => {
    if (typeof member !== 'string') throw new InvalidProfileFieldError(field, 'holds something that is not text')
    return member
  })
}

/**
 * A stored row that breaks a §4 rule is a data problem, not a request problem.
 *
 * Without this it would surface as the same InvalidProfileFieldError a bad request body
 * raises, and the edge would answer 422 — a client error, on a request the client cannot
 * correct, on the one path that never logs. Unrecognised at the edge, it becomes a logged 500.
 */
export class CorruptProfileRowError extends Error {
  readonly id: string

  constructor(id: string, cause: unknown) {
    super(`the stored profile for ${id} does not satisfy its own rules`, { cause })
    this.name = 'CorruptProfileRowError'
    this.id = id
  }
}

export function toDomain(row: ProfileRow): Profile {
  try {
    return new Profile({
      id: row.id,
      name: row.name,
      bio: row.bio,
      paceMin: row.paceMin,
      paceMax: row.paceMax,
      experience: toExperience(row.experience),
      area: row.area,
      latitude: row.latitude,
      longitude: row.longitude,
      availability: row.availability,
      usualDistance: row.usualDistance === null ? null : toUsualDistance(row.usualDistance),
      gear: row.gear === null ? null : asTexts(row.gear, 'gear'),
      photoRef: row.photoRef,
      hiddenFields: asTexts(row.hiddenFields, 'hiddenFields').map(toHiddenField),
      revision: row.revision,
    })
  } catch (error) {
    if (error instanceof InvalidProfileFieldError) throw new CorruptProfileRowError(row.id, error)
    throw error
  }
}

export function toRow(profile: Profile): ProfileInsert {
  return {
    id: profile.id,
    name: profile.name,
    bio: profile.bio,
    paceMin: profile.paceMin,
    paceMax: profile.paceMax,
    experience: profile.experience,
    area: profile.area,
    latitude: profile.latitude,
    longitude: profile.longitude,
    availability: profile.availability,
    usualDistance: profile.usualDistance,
    gear: profile.gear === null ? null : [...profile.gear],
    photoRef: profile.photoRef,
    hiddenFields: [...profile.hiddenFields],
    revision: profile.revision,
  }
}
