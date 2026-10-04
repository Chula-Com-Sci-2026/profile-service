import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import type { ProfileEvents } from '../application/ports/profile-events.ts'
import type { ServiceTokens } from './identity-service-tokens.ts'
import { type CloudEvent, profileDeleted, profileUpdated } from './profile-published-language.ts'

/**
 * ADR-0019: "a short timeout and a few retries". At worst about 3.6 s added to a runner's request.
 * Recorded in build_plan's Profile events decision; not configurable, because nobody tunes it yet.
 */
export const DELIVERY = { timeoutMs: 1_000, attempts: 3, backoffMs: [200, 400] } as const

export type HttpProfileEventsOptions = {
  /** Events endpoints, from configuration (ADR-0019: subscribers listed in the publisher's config). */
  subscribers: readonly string[]
  tokens: ServiceTokens
  /** The correlation id of the request being served, if any (NFR-7.4). */
  currentRequestId: () => string | undefined
  /** Test seams. */
  timeoutMs?: number
  backoffMs?: readonly number[]
}

/**
 * An event a subscriber never accepted. Says what was lost and where — never the event's data,
 * so the log line it becomes cannot leak a profile.
 */
export class EventNotDeliveredError extends Error {
  readonly eventId: string
  readonly type: string
  readonly subject: string
  readonly subscriber: string
  readonly attempts: number
  readonly status: number | undefined
  readonly requestId: string

  constructor(event: CloudEvent, subscriber: string, attempts: number, status: number | undefined, requestId: string) {
    super(
      `${event.type} ${event.id} was not delivered to ${subscriber} after ${attempts} attempt(s)` +
        (status === undefined ? '' : `; last status ${status}`),
    )
    this.name = 'EventNotDeliveredError'
    this.eventId = event.id
    this.type = event.type
    this.subject = event.subject
    this.subscriber = subscriber
    this.attempts = attempts
    this.status = status
    this.requestId = requestId
  }
}

/** Worth asking again: the subscriber may answer differently next time. */
function retryable(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

async function deliver(
  event: CloudEvent,
  subscriber: string,
  requestId: string,
  options: HttpProfileEventsOptions,
): Promise<void> {
  const waits = options.backoffMs ?? DELIVERY.backoffMs
  let status: number | undefined
  let attempt = 0

  while (attempt < DELIVERY.attempts) {
    if (attempt > 0) await delay(waits[attempt - 1] ?? 0)
    attempt += 1
    try {
      const token = await options.tokens.token()
      const response = await fetch(subscriber, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/cloudevents+json',
          'x-request-id': requestId,
        },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(options.timeoutMs ?? DELIVERY.timeoutMs),
      })
      await response.body?.cancel()
      status = response.status
      if (response.ok) return
      if (response.status === 401) {
        options.tokens.invalidate()
        continue
      }
      if (!retryable(response.status)) break
    } catch {
      // A network error, a timeout, or no token: worth another attempt.
      status = undefined
    }
  }

  throw new EventNotDeliveredError(event, subscriber, attempt, status, requestId)
}

/**
 * Profile events as synchronous REST POSTs (ADR-0019, phase 1): CloudEvents structured mode,
 * the same event to every subscriber, awaited by the use case. A broker replaces this adapter in
 * phase 2; the port stays.
 */
export function httpProfileEvents(options: HttpProfileEventsOptions): ProfileEvents {
  async function publish(event: CloudEvent): Promise<void> {
    const requestId = options.currentRequestId() ?? randomUUID()
    const results = await Promise.allSettled(
      options.subscribers.map((subscriber) => deliver(event, subscriber, requestId, options)),
    )
    const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failed !== undefined) throw failed.reason
  }

  return {
    updated: (profile) => publish(profileUpdated(profile)),
    deleted: (userId) => publish(profileDeleted(userId)),
  }
}
