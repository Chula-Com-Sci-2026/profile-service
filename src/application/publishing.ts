import type { ProfileEvents } from './ports/profile-events.ts'

/**
 * What a writing use case needs to tell subscribers, and to report when it could not.
 *
 * Delivery failing never fails the runner's action (ADR-0019): the write already happened, so
 * the failure is reported through `onUndelivered` and the use case carries on.
 */
export type Publishing = {
  events: ProfileEvents
  onUndelivered: (userId: string, error: unknown) => void
}
