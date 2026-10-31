import { randomUUID } from 'node:crypto'
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
  type: 'ProfileUpdated'
  time: string
  subject: string
  datacontenttype?: 'application/json'
  dataschema: string
  data?: Record<string, unknown>
}

const SOURCE = 'profile-service'

/** `:2` is the version of `data`. A breaking change moves it on; an added optional field does not. */
const DATASCHEMA = 'urn:cant-run-alone:profile-service:ProfileUpdated:2'

/**
 * openapi.yaml `PublicCard` — visibility already applied by the domain, a hidden field as `null`,
 * the point only as its cell (NFR-4.1), the photo as its public address.
 */
export function card(publicCard: PublicCard, photoUrl: (photoRef: string) => string): Record<string, unknown> {
  return {
    id: publicCard.id,
    name: publicCard.name,
    area: publicCard.area,
    areaCell: { latitude: publicCard.areaCell.latitude, longitude: publicCard.areaCell.longitude },
    photoUrl: publicCard.photoRef === null ? null : photoUrl(publicCard.photoRef),
    bio: publicCard.bio,
    paceMin: publicCard.paceMin,
    paceMax: publicCard.paceMax,
    experience: publicCard.experience,
    availability: publicCard.availability,
    usualDistance: publicCard.usualDistance,
    gear: publicCard.gear === null ? null : [...publicCard.gear],
  }
}

/** A profile changed: its public card, and nothing hidden. */
export function profileUpdated(
  profile: Profile,
  photoUrl: (photoRef: string) => string,
  at: Date = new Date(),
  id: string = randomUUID(),
): CloudEvent {
  return {
    specversion: '1.0',
    id,
    source: SOURCE,
    type: 'ProfileUpdated',
    time: at.toISOString(),
    subject: profile.id,
    datacontenttype: 'application/json',
    dataschema: DATASCHEMA,
    data: { card: card(profile.publicCard(), photoUrl) },
  }
}
