import type { PaceRange } from '../../domain/pace-range.ts'
import type { PreferredRunTime } from '../../domain/preferred-run-time.ts'
import type { Profile } from '../../domain/profile.ts'
import type { PublicCard } from '../../domain/public-card.ts'

/** Who is reading. The owner sees the whole profile; anyone else its public card — openapi.yaml `getProfile`. */
export type Audience = 'owner' | 'others'

/**
 * Domain object → JSON. The owner gets `Profile` in openapi.yaml; anyone else gets
 * `PublicCard`, serialised from `profile.publicCard()` — this file picks no fields for them,
 * because which fields others may see is the domain's rule, not the view's.
 */
export function toView(profile: Profile, audience: Audience): Record<string, unknown> {
  return audience === 'owner' ? ownerView(profile) : cardView(profile.publicCard())
}

const paceRangeView = (range: PaceRange) => ({
  fastest: range.fastest.secondsPerKilometre,
  slowest: range.slowest.secondsPerKilometre,
})

const runTimesView = (times: readonly PreferredRunTime[]) =>
  times.map((t) => ({ dayOfWeek: t.dayOfWeek, timeOfDay: t.timeOfDay }))

/**
 * Every field, the exact area and the hidden set. An unset scalar is absent, never null; an
 * unset set is `[]`. Units live in the contract's descriptions, so values are bare numbers.
 */
function ownerView(profile: Profile): Record<string, unknown> {
  const cell = profile.area.cell()
  return {
    userId: profile.userId,
    displayName: profile.displayName,
    area: { latitude: profile.area.latitude, longitude: profile.area.longitude },
    areaCell: { latitude: cell.latitude, longitude: cell.longitude },
    preferredRunTimes: runTimesView(profile.preferredRunTimes),
    gear: [...profile.gear],
    hiddenFields: [...profile.hiddenFields],
    ...(profile.bio !== undefined && { bio: profile.bio }),
    ...(profile.avatarRef !== undefined && { avatarRef: profile.avatarRef }),
    ...(profile.birthYear !== undefined && { birthYear: profile.birthYear }),
    ...(profile.gender !== undefined && { gender: profile.gender }),
    ...(profile.paceRange !== undefined && { paceRange: paceRangeView(profile.paceRange) }),
    ...(profile.usualDistance !== undefined && { usualDistance: profile.usualDistance.metres }),
    ...(profile.experience !== undefined && { experience: profile.experience }),
  }
}

/** A public card as JSON — `PublicCard` in openapi.yaml. What is absent from the card is absent here. */
export function cardView(card: PublicCard): Record<string, unknown> {
  return {
    userId: card.userId,
    displayName: card.displayName,
    areaCell: { latitude: card.areaCell.latitude, longitude: card.areaCell.longitude },
    ...(card.avatarRef !== undefined && { avatarRef: card.avatarRef }),
    ...(card.bio !== undefined && { bio: card.bio }),
    ...(card.birthYear !== undefined && { birthYear: card.birthYear }),
    ...(card.gender !== undefined && { gender: card.gender }),
    ...(card.paceRange !== undefined && { paceRange: paceRangeView(card.paceRange) }),
    ...(card.usualDistance !== undefined && { usualDistance: card.usualDistance.metres }),
    ...(card.experience !== undefined && { experience: card.experience }),
    ...(card.preferredRunTimes !== undefined && { preferredRunTimes: runTimesView(card.preferredRunTimes) }),
    ...(card.gear !== undefined && { gear: [...card.gear] }),
  }
}
