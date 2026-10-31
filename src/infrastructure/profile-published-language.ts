import type { Profile } from '../domain/profile.ts'
import type { PublicCard } from '../domain/public-card.ts'

/**
 * Profile's published language — what Buddy Discovery reads (domain.md §1). Its contract is
 * `docs/profile-events.schema.json`, and it is tested against that file.
 *
 * Deliberately separate from `interface/http/profile-view.ts`: the API and the events may change
 * on different schedules, and an event schema is kept apart from the publisher's internal model
 * (the team's context-map notes). The card it carries is serialised here and in the view from the
 * same `PublicCard`; a unit test pins the two equal, because the layers may not import each other.
 */

/** The public card plus the profile's revision — every key always present, hidden or unset as null. */
export type ProfileUpdatedPayload = Record<string, unknown> & { id: string; revision: number }

/** `events.md`'s envelope, the one every event on `cra.events` travels in. */
export type ProfileUpdatedEvent = {
  eventId: string
  eventType: 'ProfileUpdated'
  version: 1
  occurredAt: string
  correlationId: string
  payload: ProfileUpdatedPayload
}

/** What makes one event of a change: its own id, when the change was saved, and the request it came from. */
export type EventMeta = { eventId: string; occurredAt: Date; correlationId: string }

/**
 * openapi.yaml `PublicCard` — visibility already applied by the domain, a hidden field as `null`,
 * the point only as its cell (NFR-4.1), the photo as its public address.
 */
export function card(publicCard: PublicCard, photoUrl: (photoRef: string) => string): Record<string, unknown> & { id: string } {
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

/**
 * A profile changed: its public card, nothing hidden, and its revision — so a copy that receives
 * two cards out of order keeps the newer one (domain.md §1).
 */
export function profileUpdated(profile: Profile, photoUrl: (photoRef: string) => string, meta: EventMeta): ProfileUpdatedEvent {
  return {
    eventId: meta.eventId,
    eventType: 'ProfileUpdated',
    version: 1,
    occurredAt: meta.occurredAt.toISOString(),
    correlationId: meta.correlationId,
    payload: { ...card(profile.publicCard(), photoUrl), revision: profile.revision },
  }
}
