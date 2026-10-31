import type { ProfileUpdatedEvent } from './profile-published-language.ts'

/**
 * How an event leaves the service — the one sender interface (build_plan's **Profile events**).
 * Exactly one is active, chosen by `EVENT_SENDER`; RabbitMQ is the only one today, and REST would
 * be another adapter here, never a change to the relay or the use cases.
 */
export type EventSender = {
  /** Resolves once the broker has the event; rejects, saying why, when it does not. */
  send: (event: ProfileUpdatedEvent) => Promise<void>
  /** Lets go of whatever connection it holds. */
  close: () => Promise<void>
}
