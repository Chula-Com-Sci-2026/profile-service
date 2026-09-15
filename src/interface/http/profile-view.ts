import type { Profile } from '../../domain/profile.ts'

/**
 * Domain object → JSON, matching `Profile` in openapi.yaml.
 *
 * An unset scalar is absent, never null. An unset set is `[]`. A `Pace` becomes a bare number,
 * because the unit lives in the contract's description rather than in the value.
 */
export function toView(profile: Profile): Record<string, unknown> {
  return {
    userId: profile.userId,
    displayName: profile.displayName,
    birthYear: profile.birthYear,
    preferredDistances: profile.preferredDistances.map((d) => d.distance),
    preferredRunTimes: profile.preferredRunTimes.map((t) => ({
      dayOfWeek: t.dayOfWeek,
      timeOfDay: t.timeOfDay,
    })),
    ...(profile.bio !== undefined && { bio: profile.bio }),
    ...(profile.avatarRef !== undefined && { avatarRef: profile.avatarRef }),
    ...(profile.gender !== undefined && { gender: profile.gender }),
    ...(profile.area !== undefined && { area: profile.area }),
    ...(profile.pace !== undefined && { pace: profile.pace.secondsPerKilometre }),
    ...(profile.volume !== undefined && { volume: profile.volume.metresPerWeek }),
    ...(profile.experience !== undefined && { experience: profile.experience }),
  }
}
