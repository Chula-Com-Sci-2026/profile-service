import { Area } from '../../domain/area.ts'
import { toExperience } from '../../domain/experience.ts'
import { toGender } from '../../domain/gender.ts'
import { PaceRange } from '../../domain/pace-range.ts'
import { PreferredRunTime } from '../../domain/preferred-run-time.ts'
import type { ProfileChanges, ProfileFields } from '../../domain/profile.ts'
import { UsualDistance } from '../../domain/usual-distance.ts'
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
    area: new Area(body.area.latitude, body.area.longitude),
    preferredRunTimes: (body.preferredRunTimes ?? []).map((t) => new PreferredRunTime(t.dayOfWeek, t.timeOfDay)),
    gear: body.gear ?? [],
    ...(body.bio !== undefined && { bio: body.bio }),
    ...(body.avatarRef !== undefined && { avatarRef: body.avatarRef }),
    ...(body.birthYear !== undefined && { birthYear: body.birthYear }),
    ...(body.gender !== undefined && { gender: toGender(body.gender) }),
    ...(body.paceRange !== undefined && { paceRange: new PaceRange(body.paceRange.fastest, body.paceRange.slowest) }),
    ...(body.usualDistance !== undefined && { usualDistance: new UsualDistance(body.usualDistance) }),
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
    ...(body.area !== undefined && { area: new Area(body.area.latitude, body.area.longitude) }),
    ...(body.paceRange !== undefined && {
      paceRange: body.paceRange === null ? null : new PaceRange(body.paceRange.fastest, body.paceRange.slowest),
    }),
    ...(body.usualDistance !== undefined && {
      usualDistance: body.usualDistance === null ? null : new UsualDistance(body.usualDistance),
    }),
    ...(body.experience !== undefined && {
      experience: body.experience === null ? null : toExperience(body.experience),
    }),
    ...(body.preferredRunTimes !== undefined && {
      preferredRunTimes: body.preferredRunTimes.map((t) => new PreferredRunTime(t.dayOfWeek, t.timeOfDay)),
    }),
    ...(body.gear !== undefined && { gear: body.gear }),
  }
}
