import { toArea } from '../../domain/area.ts'
import { toExperience } from '../../domain/experience.ts'
import { toGender } from '../../domain/gender.ts'
import { Pace } from '../../domain/pace.ts'
import { PreferredDistance } from '../../domain/preferred-distance.ts'
import { PreferredRunTime } from '../../domain/preferred-run-time.ts'
import type { ProfileChanges, ProfileFields } from '../../domain/profile.ts'
import { Volume } from '../../domain/volume.ts'
import type { ProfilePatchBody, ProfileWriteBody } from './validators.ts'

/**
 * Validated body → domain types.
 *
 * Zod infers an optional field as `T | undefined`, which `exactOptionalPropertyTypes` refuses
 * to hand to the domain — so omit the key rather than forwarding an `undefined`. That is what
 * keeps "an unset scalar is absent" true past the edge.
 */
export function toFields(userId: string, body: ProfileWriteBody): ProfileFields {
  return {
    userId,
    displayName: body.displayName,
    birthYear: body.birthYear,
    preferredDistances: (body.preferredDistances ?? []).map((d) => new PreferredDistance(d)),
    preferredRunTimes: (body.preferredRunTimes ?? []).map((t) => new PreferredRunTime(t.dayOfWeek, t.timeOfDay)),
    ...(body.bio !== undefined && { bio: body.bio }),
    ...(body.avatarRef !== undefined && { avatarRef: body.avatarRef }),
    ...(body.gender !== undefined && { gender: toGender(body.gender) }),
    ...(body.area !== undefined && { area: toArea(body.area) }),
    ...(body.pace !== undefined && { pace: new Pace(body.pace) }),
    ...(body.volume !== undefined && { volume: new Volume(body.volume) }),
    ...(body.experience !== undefined && { experience: toExperience(body.experience) }),
  }
}

/** `null` survives the crossing — it is how the merge patch says "clear this". */
export function toChanges(body: ProfilePatchBody): ProfileChanges {
  return {
    ...(body.displayName !== undefined && { displayName: body.displayName }),
    ...(body.birthYear !== undefined && { birthYear: body.birthYear }),
    ...(body.bio !== undefined && { bio: body.bio }),
    ...(body.avatarRef !== undefined && { avatarRef: body.avatarRef }),
    ...(body.gender !== undefined && { gender: body.gender === null ? null : toGender(body.gender) }),
    ...(body.area !== undefined && { area: body.area === null ? null : toArea(body.area) }),
    ...(body.pace !== undefined && { pace: body.pace === null ? null : new Pace(body.pace) }),
    ...(body.volume !== undefined && { volume: body.volume === null ? null : new Volume(body.volume) }),
    ...(body.experience !== undefined && {
      experience: body.experience === null ? null : toExperience(body.experience),
    }),
    ...(body.preferredDistances !== undefined && {
      preferredDistances: body.preferredDistances.map((d) => new PreferredDistance(d)),
    }),
    ...(body.preferredRunTimes !== undefined && {
      preferredRunTimes: body.preferredRunTimes.map((t) => new PreferredRunTime(t.dayOfWeek, t.timeOfDay)),
    }),
  }
}
