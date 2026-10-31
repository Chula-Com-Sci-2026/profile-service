import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import type { ProfileEvents } from '../application/ports/profile-events.ts'
import type { ServiceTokens } from './identity-service-tokens.ts'
import { type CloudEvent, profileDeleted, profileUpdated } from './profile-published-language.ts'

/**
 * ADR-0019: "a short timeout and a few retries". At worst about 3.6 s added to a runner's request:
 * three 1 s attempts, each covering the token and the POST, plus the two waits.
 * Recorded in build_plan's Profile events decision; not configurable, because nobody tunes it yet.
 */
export const DELIVERY = { timeoutMs: 1_000, attempts: 3, backoffMs: [200, 400] } as const

export type HttpProfileEventsOptions = {
  /** Events endpoints, from configuration (ADR-0019: subscribers listed in the publisher's config). */
  subscribers: readonly string[]
  tokens: ServiceTokens
  /** The correlation id of the request being served, if any (NFR-7.4). */
  currentCorrelationId: () => string | undefined
  /** Test seams. */
  timeoutMs?: number
  backoffMs?: readonly number[]
}

/** Which step of an attempt failed last: getting Identity's token, or the POST itself. */
export type FailedStep = { stage: 'token' | 'delivery'; reason: string }

/**
 * An event a subscriber never accepted. Says what was lost, where, and which step failed —
 * a refused token is a misconfiguration at Identity, not an outage at the subscriber — and never
 * the event's data, so the log line it becomes cannot leak a profile.
 */
export class EventNotDeliveredError extends Error {
  readonly eventId: string
  /** Not `type`: pino writes the error's class name there and would overwrite it. */
  readonly eventType: string
  readonly subject: string
  readonly subscriber: string
  readonly attempts: number
  readonly status: number | undefined
  readonly correlationId: string
  readonly stage: FailedStep['stage']

  constructor(
    event: CloudEvent,
    subscriber: string,
    attempts: number,
    status: number | undefined,
    correlationId: string,
    failure: FailedStep,
  ) {
    super(
      `${event.type} ${event.id} was not delivered to ${subscriber} after ${attempts} attempt(s): ` +
        `${failure.stage} failed — ${failure.reason}`,
    )
    this.name = 'EventNotDeliveredError'
    this.eventId = event.id
    this.eventType = event.type
    this.subject = event.subject
    this.subscriber = subscriber
    this.attempts = attempts
    this.status = status
    this.correlationId = correlationId
    this.stage = failure.stage
  }
}

/** What went wrong, in words safe to log: a timeout, a network code, or the error's own message. */
function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  if (error.name === 'TimeoutError') return 'timed out'
  const code = (error.cause as { code?: unknown } | undefined)?.code
  return typeof code === 'string' ? `${error.message} (${code})` : error.message
}

/** Worth asking again: the subscriber may answer differently next time. */
function retryable(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

async function deliver(
  event: CloudEvent,
  subscriber: string,
  correlationId: string,
  options: HttpProfileEventsOptions,
): Promise<void> {
  const waits = options.backoffMs ?? DELIVERY.backoffMs
  let status: number | undefined
  let failure: FailedStep = { stage: 'delivery', reason: 'not attempted' }
  let attempt = 0

  while (attempt < DELIVERY.attempts) {
    if (attempt > 0) await delay(waits[attempt - 1] ?? 0)
    attempt += 1
    // One deadline for the whole attempt — the token and the POST share it, so a slow Identity
    // cannot stretch an attempt past the timeout ADR-0019 asks to be short.
    const signal = AbortSignal.timeout(options.timeoutMs ?? DELIVERY.timeoutMs)

    let token: string
    try {
      token = await options.tokens.token(signal)
    } catch (error) {
      status = undefined
      failure = { stage: 'token', reason: describe(error) }
      continue
    }

    try {
      const response = await fetch(subscriber, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/cloudevents+json',
          'x-correlation-id': correlationId,
        },
        body: JSON.stringify(event),
        signal,
      })
      await response.body?.cancel()
      status = response.status
      if (response.ok) return
      failure = { stage: 'delivery', reason: `status ${response.status}` }
      if (response.status === 401) {
        options.tokens.invalidate()
        continue
      }
      if (!retryable(response.status)) break
    } catch (error) {
      // A network error or a timeout: worth another attempt.
      status = undefined
      failure = { stage: 'delivery', reason: describe(error) }
    }
  }

  throw new EventNotDeliveredError(event, subscriber, attempt, status, correlationId, failure)
}

/**
 * Profile events as synchronous REST POSTs (ADR-0019, phase 1): CloudEvents structured mode,
 * the same event to every subscriber, awaited by the use case. A broker replaces this adapter in
 * phase 2; the port stays.
 */
export function httpProfileEvents(options: HttpProfileEventsOptions): ProfileEvents {
  async function publish(event: CloudEvent): Promise<void> {
    const correlationId = options.currentCorrelationId() ?? randomUUID()
    const results = await Promise.allSettled(
      options.subscribers.map((subscriber) => deliver(event, subscriber, correlationId, options)),
    )
    // Each subscriber that failed is its own outage, so each is reported: one failure as itself,
    // several as an AggregateError that logUndelivered writes out one line apiece.
    const failures = results.flatMap((result) => (result.status === 'rejected' ? [result.reason as unknown] : []))
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, `${event.type} ${event.id} reached no subscriber of ${failures.length}`)
  }

  return {
    updated: (profile) => publish(profileUpdated(profile)),
    deleted: (userId) => publish(profileDeleted(userId)),
  }
}

/** The one call a logger must answer for `logUndelivered` — pino's `error` fits it. */
export type ErrorLog = { error: (fields: object, message: string) => void }

/**
 * The log line for an event no subscriber accepted. The correlation id goes at the top level,
 * where every other line of the request has it, so one query finds the request and its lost event
 * (NFR-7.4). The error names the event, the subscriber and the failing step — never the profile.
 */
export function logUndelivered(log: ErrorLog, currentCorrelationId: () => string | undefined) {
  return (userId: string, error: unknown): void => {
    for (const failure of error instanceof AggregateError ? error.errors : [error]) {
      const correlationId = failure instanceof EventNotDeliveredError ? failure.correlationId : currentCorrelationId()
      log.error({ err: failure, userId, correlationId }, 'a profile event was not delivered')
    }
  }
}
