import type { EventSender } from './event-sender.ts'
import type { Outbox, OutboxMessage } from './outbox.ts'
import type { ProfileUpdatedEvent } from './profile-published-language.ts'

/** How often the relay looks for waiting events — Discovery's own outbox interval. */
export const RELAY_INTERVAL_MS = 2_000

/** The two calls the relay makes of a logger — pino's fit them. */
export type RelayLog = {
  info: (fields: object, message: string) => void
  warn: (fields: object, message: string) => void
}

export type OutboxRelayOptions = {
  outbox: Outbox
  sender: EventSender
  log: RelayLog
  /** A test seam; `RELAY_INTERVAL_MS` otherwise. */
  intervalMs?: number
}

export type OutboxRelay = {
  /** Ticks every interval until stopped. */
  start: () => void
  /** One tick: sends what waits, oldest first, until the outbox is empty or a send fails. */
  runOnce: () => Promise<void>
  /** Lets the tick in flight finish, sends nothing more, then closes the sender. */
  stop: () => Promise<void>
}

/**
 * What a delivery log line names: the event, its runner and the request behind it — never the
 * payload, so no log line can carry a card.
 *
 * A row's envelope is read back from a `jsonb` column, so it is checked here rather than trusted:
 * one that lacks a name it should carry is refused before it is sent, and the refusal is an outage
 * like any other — logged once, holding back the rows behind it, never thrown out of a tick.
 */
function names({ sequence, event }: OutboxMessage): Record<string, string> {
  const envelope = event as Partial<Record<keyof ProfileUpdatedEvent, unknown>> | null
  const payload = envelope?.payload as { id?: unknown } | null | undefined
  const found = {
    eventId: envelope?.eventId,
    eventType: envelope?.eventType,
    id: payload?.id,
    correlationId: envelope?.correlationId,
  }
  const missing = Object.entries(found).filter(([, value]) => typeof value !== 'string').map(([name]) => name)
  if (missing.length > 0) {
    throw new Error(`outbox row ${sequence} is not a ProfileUpdated envelope: it has no ${missing.join(', ')}`)
  }
  return found as Record<string, string>
}

/**
 * Sends the outbox, inside the service process. Oldest first and one at a time, stopping at the
 * first failure, so a runner's events never overtake each other: an event that cannot go holds
 * back every one behind it until it does. A row is marked sent only once the sender resolved.
 *
 * Whatever fails — the broker, the queue no one bound yet, the database — is an outage, and an
 * outage is logged once when it starts and once when it ends, never on every tick.
 */
export function outboxRelay({ outbox, sender, log, intervalMs = RELAY_INTERVAL_MS }: OutboxRelayOptions): OutboxRelay {
  let stopping = false
  let failing = false
  let inFlight: Promise<void> | undefined
  let timer: NodeJS.Timeout | undefined

  async function drain(): Promise<void> {
    while (!stopping) {
      // Built inside the try, so neither line below can throw: the row's place until its names are known.
      let fields: Record<string, unknown> = {}
      try {
        const message = await outbox.oldestUnsent()
        if (message === null) return
        fields = { sequence: message.sequence }
        fields = names(message)
        await sender.send(message.event)
        await outbox.markSent(message.sequence)
      } catch (error) {
        if (!failing) log.warn({ err: error, ...fields }, 'profile events cannot be delivered; they wait in the outbox')
        failing = true
        return
      }
      if (failing) log.info(fields, 'profile events are being delivered again')
      failing = false
      log.info(fields, 'profile event sent')
    }
  }

  function runOnce(): Promise<void> {
    // One tick at a time: a second caller waits on the tick already running.
    inFlight ??= drain().finally(() => {
      inFlight = undefined
    })
    return inFlight
  }

  /**
   * One tick, then the next. Whatever a tick throws is logged and the ticks go on: a rejection
   * here would go unhandled — and Node exits on that, taking the HTTP server with it — and the
   * next tick would never be scheduled.
   */
  function tick(): void {
    void runOnce()
      .catch((error: unknown) => log.warn({ err: error }, 'a relay tick failed; the next one runs as usual'))
      .finally(schedule)
  }

  function schedule(): void {
    if (stopping) return
    timer = setTimeout(tick, intervalMs)
    // The relay never keeps the process alive on its own; the server does.
    timer.unref()
  }

  return {
    start: tick,
    runOnce,
    stop: async () => {
      stopping = true
      clearTimeout(timer)
      await inFlight
      await sender.close()
    },
  }
}
