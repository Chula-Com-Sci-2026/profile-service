import type { ProfileEvents } from '../application/ports/profile-events.ts'

/**
 * Publishes nothing. For a service with no subscriber configured — a clone, a laptop, the test
 * suite — and for writes that are not committed yet, like the seed's transaction.
 */
export const silentProfileEvents: ProfileEvents = {
  updated: async () => {},
  deleted: async () => {},
}
