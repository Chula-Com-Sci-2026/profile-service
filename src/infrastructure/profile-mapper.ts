import { toArea } from '../domain/area.ts'
import { InvalidProfileFieldError } from '../domain/errors.ts'
import { toExperience } from '../domain/experience.ts'
import { toGender } from '../domain/gender.ts'
import { Pace } from '../domain/pace.ts'
import { PreferredDistance } from '../domain/preferred-distance.ts'
import { PreferredRunTime } from '../domain/preferred-run-time.ts'
import { Profile } from '../domain/profile.ts'
import { Volume } from '../domain/volume.ts'
import type { ProfileInsert, ProfileRow } from './schema.ts'

/**
 * snake_case ↔ camelCase, columns ↔ value objects.
 *
 * Row → domain is a boundary. The table enforces shape and the primary key and nothing else —
 * every §4 rule lives in TypeScript — so a value read back is validated as if it arrived from
 * a stranger. A row written by an older version of this code, or by hand, fails here rather
 * than becoming a Profile that breaks its own rules.
 */

/**
 * `jsonb NOT NULL` rejects SQL NULL, not JSON `null` — `'null'::jsonb` and `'"marathon"'::jsonb`
 * both satisfy the constraint, and `$type<string[]>()` is an unchecked assertion, so the column
 * can hand back anything. Check the shape here, or a hand-written row leaves as a TypeError and
 * the edge turns a bad row into a 500 instead of a 4xx.
 */
function asArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new InvalidProfileFieldError(field, 'is not stored as an array')
  return value
}

function asDistances(value: unknown): PreferredDistance[] {
  return asArray(value, 'preferredDistances').map((member) => {
    if (typeof member !== 'string') {
      throw new InvalidProfileFieldError('preferredDistances', 'holds something that is not a distance')
    }
    return new PreferredDistance(member)
  })
}

function asRunTimes(value: unknown): PreferredRunTime[] {
  return asArray(value, 'preferredRunTimes').map((member) => {
    if (typeof member !== 'object' || member === null) {
      throw new InvalidProfileFieldError('preferredRunTimes', 'holds something that is not a day and a time')
    }
    const { dayOfWeek, timeOfDay } = member as { dayOfWeek?: unknown; timeOfDay?: unknown }
    if (typeof dayOfWeek !== 'string' || typeof timeOfDay !== 'string') {
      throw new InvalidProfileFieldError('preferredRunTimes', 'holds an entry missing its day or its time')
    }
    return new PreferredRunTime(dayOfWeek, timeOfDay)
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
  readonly userId: string

  constructor(userId: string, cause: unknown) {
    super(`the stored profile for ${userId} does not satisfy its own rules`, { cause })
    this.name = 'CorruptProfileRowError'
    this.userId = userId
  }
}

export function toDomain(row: ProfileRow): Profile {
  try {
    return buildProfile(row)
  } catch (error) {
    if (error instanceof InvalidProfileFieldError) throw new CorruptProfileRowError(row.userId, error)
    throw error
  }
}

function buildProfile(row: ProfileRow): Profile {
  return new Profile({
    userId: row.userId,
    displayName: row.displayName,
    birthYear: row.birthYear,
    preferredDistances: asDistances(row.preferredDistances),
    preferredRunTimes: asRunTimes(row.preferredRunTimes),
    ...(row.bio !== null && { bio: row.bio }),
    ...(row.avatarRef !== null && { avatarRef: row.avatarRef }),
    ...(row.gender !== null && { gender: toGender(row.gender) }),
    ...(row.area !== null && { area: toArea(row.area) }),
    ...(row.pace !== null && { pace: new Pace(row.pace) }),
    ...(row.volume !== null && { volume: new Volume(row.volume) }),
    ...(row.experience !== null && { experience: toExperience(row.experience) }),
  })
}

export function toRow(profile: Profile): ProfileInsert {
  return {
    userId: profile.userId,
    displayName: profile.displayName,
    bio: profile.bio ?? null,
    avatarRef: profile.avatarRef ?? null,
    birthYear: profile.birthYear,
    gender: profile.gender ?? null,
    area: profile.area ?? null,
    pace: profile.pace?.secondsPerKilometre ?? null,
    volume: profile.volume?.metresPerWeek ?? null,
    experience: profile.experience ?? null,
    preferredDistances: profile.preferredDistances.map((distance) => distance.distance),
    preferredRunTimes: profile.preferredRunTimes.map((time) => ({
      dayOfWeek: time.dayOfWeek,
      timeOfDay: time.timeOfDay,
    })),
  }
}
