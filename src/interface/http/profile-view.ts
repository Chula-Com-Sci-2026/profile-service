import type { Profile } from '../../domain/profile.ts'

/** Who is reading. Only the runner a profile describes sees its exact area — openapi.yaml, `bearerAuth`. */
export type Audience = 'owner' | 'others'

/**
 * Domain object → JSON, matching `Profile` in openapi.yaml.
 *
 * An unset scalar is absent, never null. An unset set is `[]`. A `PaceRange` becomes two bare
 * numbers and a `UsualDistance` one, because the unit lives in the contract's description rather
 * than in the value. Every caller gets `areaCell`; only the owner gets `area` — the key is absent
 * for anyone else, not nulled.
 */
export function toView(profile: Profile, audience: Audience): Record<string, unknown> {
  const cell = profile.area.cell()
  return {
    userId: profile.userId,
    displayName: profile.displayName,
    ...(audience === 'owner' && {
      area: { latitude: profile.area.latitude, longitude: profile.area.longitude },
    }),
    areaCell: { latitude: cell.latitude, longitude: cell.longitude },
    preferredRunTimes: profile.preferredRunTimes.map((t) => ({
      dayOfWeek: t.dayOfWeek,
      timeOfDay: t.timeOfDay,
    })),
    gear: [...profile.gear],
    ...(profile.bio !== undefined && { bio: profile.bio }),
    ...(profile.avatarRef !== undefined && { avatarRef: profile.avatarRef }),
    ...(profile.birthYear !== undefined && { birthYear: profile.birthYear }),
    ...(profile.gender !== undefined && { gender: profile.gender }),
    ...(profile.paceRange !== undefined && {
      paceRange: {
        fastest: profile.paceRange.fastest.secondsPerKilometre,
        slowest: profile.paceRange.slowest.secondsPerKilometre,
      },
    }),
    ...(profile.usualDistance !== undefined && { usualDistance: profile.usualDistance.metres }),
    ...(profile.experience !== undefined && { experience: profile.experience }),
  }
}
