import { randomUUID } from 'node:crypto'
import type { PaceRange } from '../domain/pace-range.ts'
import type { PreferredRunTime } from '../domain/preferred-run-time.ts'
import type { Profile } from '../domain/profile.ts'
import type { PublicCard } from '../domain/public-card.ts'

/**
 * Profile's published language — what Buddy Discovery reads (domain.md §1). Described in
 * openapi.yaml under `webhooks`, and tested against it.
 *
 * Deliberately separate from `interface/http/profile-view.ts`: the API and the events may change
 * on different schedules, and an event schema is kept apart from the publisher's internal model
 * (the team's context-map notes). The card it carries is serialised here and in the view from the
 * same `PublicCard`; a unit test pins the two equal, because the layers may not import each other.
 */
export type CloudEvent = {
  specversion: '1.0'
  id: string
  source: 'profile-service'
  type: 'ProfileUpdated' | 'ProfileDeleted'
  time: string
  subject: string
  datacontenttype?: 'application/json'
  dataschema: string
  data?: Record<string, unknown>
}

const SOURCE = 'profile-service'

/** `:1` is the version of `data`. A breaking change moves it to `:2`; an added optional field does not. */
const DATASCHEMA = {
  ProfileUpdated: 'urn:cant-run-alone:profile-service:ProfileUpdated:1',
  ProfileDeleted: 'urn:cant-run-alone:profile-service:ProfileDeleted:1',
} as const

const paceRangeJson = (range: PaceRange) => ({
  fastest: range.fastest.secondsPerKilometre,
  slowest: range.slowest.secondsPerKilometre,
})

const runTimesJson = (times: readonly PreferredRunTime[]) =>
  times.map((t) => ({ dayOfWeek: t.dayOfWeek, timeOfDay: t.timeOfDay }))

/** openapi.yaml `PublicCard` — visibility already applied by the domain; the area only as its cell (NFR-4.1). */
export function card(publicCard: PublicCard): Record<string, unknown> {
  return {
    userId: publicCard.userId,
    displayName: publicCard.displayName,
    areaCell: { latitude: publicCard.areaCell.latitude, longitude: publicCard.areaCell.longitude },
    ...(publicCard.avatarRef !== undefined && { avatarRef: publicCard.avatarRef }),
    ...(publicCard.bio !== undefined && { bio: publicCard.bio }),
    ...(publicCard.birthYear !== undefined && { birthYear: publicCard.birthYear }),
    ...(publicCard.gender !== undefined && { gender: publicCard.gender }),
    ...(publicCard.paceRange !== undefined && { paceRange: paceRangeJson(publicCard.paceRange) }),
    ...(publicCard.usualDistance !== undefined && { usualDistance: publicCard.usualDistance.metres }),
    ...(publicCard.experience !== undefined && { experience: publicCard.experience }),
    ...(publicCard.preferredRunTimes !== undefined && { preferredRunTimes: runTimesJson(publicCard.preferredRunTimes) }),
    ...(publicCard.gear !== undefined && { gear: [...publicCard.gear] }),
  }
}

/**
 * openapi.yaml `Matching` — what Buddy Discovery ranks on (FR-4.1, FR-4.2), even when hidden
 * from other runners (the team's architecture notes). Nothing else hidden ever leaves.
 */
export function matching(profile: Profile): Record<string, unknown> {
  return {
    ...(profile.paceRange !== undefined && { paceRange: paceRangeJson(profile.paceRange) }),
    ...(profile.experience !== undefined && { experience: profile.experience }),
    preferredRunTimes: runTimesJson(profile.preferredRunTimes),
  }
}

/** A profile was created or changed. */
export function profileUpdated(profile: Profile, at: Date = new Date(), id: string = randomUUID()): CloudEvent {
  return {
    specversion: '1.0',
    id,
    source: SOURCE,
    type: 'ProfileUpdated',
    time: at.toISOString(),
    subject: profile.userId,
    datacontenttype: 'application/json',
    dataschema: DATASCHEMA.ProfileUpdated,
    data: { card: card(profile.publicCard()), matching: matching(profile) },
  }
}

/** A profile was removed. No data: `subject` names the runner. */
export function profileDeleted(userId: string, at: Date = new Date(), id: string = randomUUID()): CloudEvent {
  return {
    specversion: '1.0',
    id,
    source: SOURCE,
    type: 'ProfileDeleted',
    time: at.toISOString(),
    subject: userId,
    dataschema: DATASCHEMA.ProfileDeleted,
  }
}
