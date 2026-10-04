import { randomUUID } from 'node:crypto'
import type { Profile } from '../domain/profile.ts'

/**
 * Profile's published language — what Buddy Discovery reads (domain.md §1). Described in
 * openapi.yaml under `webhooks`, and tested against it.
 *
 * Deliberately separate from `interface/http/profile-view.ts`, though today the two agree field
 * for field: the API and the events may change on different schedules, and an event schema is
 * kept apart from the publisher's internal model (the team's context-map notes).
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

/**
 * The profile as another runner sees it — openapi.yaml `PublicProfile`. The area leaves only as
 * its cell (NFR-4.1, ADR-0016); an unset scalar is absent, an unset set is `[]`.
 */
export function publicProfile(profile: Profile): Record<string, unknown> {
  const cell = profile.area.cell()
  return {
    userId: profile.userId,
    displayName: profile.displayName,
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
    data: publicProfile(profile),
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
