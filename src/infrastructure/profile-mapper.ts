import { isArea, type Area } from '../domain/area.ts'
import { InvalidProfileFieldError } from '../domain/errors.ts'
import { isExperience, type Experience } from '../domain/experience.ts'
import { isGender, type Gender } from '../domain/gender.ts'
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

function asGender(value: string): Gender {
  if (!isGender(value)) throw new InvalidProfileFieldError('gender', 'is not a known value')
  return value
}

function asArea(value: string): Area {
  if (!isArea(value)) throw new InvalidProfileFieldError('area', 'is not a known value')
  return value
}

function asExperience(value: string): Experience {
  if (!isExperience(value)) throw new InvalidProfileFieldError('experience', 'is not a known value')
  return value
}

export function toDomain(row: ProfileRow): Profile {
  return new Profile({
    userId: row.userId,
    displayName: row.displayName,
    birthYear: row.birthYear,
    preferredDistances: row.preferredDistances.map((distance) => new PreferredDistance(distance)),
    preferredRunTimes: row.preferredRunTimes.map((time) => new PreferredRunTime(time.dayOfWeek, time.timeOfDay)),
    ...(row.bio !== null && { bio: row.bio }),
    ...(row.avatarRef !== null && { avatarRef: row.avatarRef }),
    ...(row.gender !== null && { gender: asGender(row.gender) }),
    ...(row.area !== null && { area: asArea(row.area) }),
    ...(row.pace !== null && { pace: new Pace(row.pace) }),
    ...(row.volume !== null && { volume: new Volume(row.volume) }),
    ...(row.experience !== null && { experience: asExperience(row.experience) }),
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
