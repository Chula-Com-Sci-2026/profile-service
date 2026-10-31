import { randomUUID } from 'node:crypto'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { ProfileEvents } from '../application/ports/profile-events.ts'
import { profileUpdated } from './profile-published-language.ts'
import { outbox } from './schema.ts'

export type OutboxEventsOptions = {
  /** A photo's public address, for the card the event carries. */
  photoUrl: (photoRef: string) => string
  /** The correlation id of the request being served, or of the seed's or the republish's run (NFR-7.4). */
  correlationId: () => string
}

/**
 * Profile events into the outbox: `updated()` writes the event's row on the connection it is given
 * — the unit of work's transaction — so the event commits with its change or not at all. Sending is
 * the relay's job, later; nothing here talks to the broker.
 */
export function outboxProfileEvents(db: NodePgDatabase, options: OutboxEventsOptions): ProfileEvents {
  return {
    updated: async (profile) => {
      const occurredAt = new Date()
      const event = profileUpdated(profile, options.photoUrl, {
        eventId: randomUUID(),
        occurredAt,
        correlationId: options.correlationId(),
      })
      await db.insert(outbox).values({ eventId: event.eventId, eventType: event.eventType, payload: event, occurredAt })
    },
  }
}
