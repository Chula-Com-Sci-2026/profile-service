import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import type { Logger } from 'pino'
import type { Env } from './context.ts'
import { isUuid } from './uuid.ts'

/** The team's correlation header (NFR-7.4), as Notification and the gateway use it. */
export const CORRELATION_ID_HEADER = 'X-Correlation-Id'

/**
 * The id a request is known by. A UUID a caller sends is kept, lowercased, so it joins the
 * request that caused this one; anything else is replaced by a fresh UUID — an id every service
 * can join on, and no way for a caller to write arbitrary text into our logs.
 */
export function correlationIdFrom(given: string | undefined): string {
  return given !== undefined && isUuid(given) ? given.toLowerCase() : randomUUID()
}

const correlationIds = new AsyncLocalStorage<string>()

/**
 * The correlation id of the request being served, for code that never sees the request — the
 * profile-event publisher passes it on to the next service (NFR-7.4). Undefined outside one.
 *
 * `src/index.ts` hands this function to the publisher, so no layer imports across the rules.
 */
export function currentCorrelationId(): string | undefined {
  return correlationIds.getStore()
}

/**
 * This request's correlation id. The request context sets it first thing, so this is nearly
 * always a read; it mints one only where that middleware never ran, so an error answered from
 * there still carries an id, the same in its body and its header.
 */
export function correlationIdOf(c: Context<Env>): string {
  const known = c.get('correlationId') as string | undefined
  if (known !== undefined) return known
  const minted = correlationIdFrom(undefined)
  c.set('correlationId', minted)
  c.header(CORRELATION_ID_HEADER, minted)
  return minted
}

/**
 * First in the chain: establishes the correlation id and the logger for this request.
 *
 * The id is echoed on every response and every line written while serving the request carries
 * it as `correlationId`, with no logger threaded through call signatures. `hono/logger` exists
 * but writes prose rather than JSON.
 */
export function requestContext(base: Logger) {
  return createMiddleware<Env>(async (c, next) => {
    const correlationId = correlationIdFrom(c.req.header(CORRELATION_ID_HEADER))

    c.set('correlationId', correlationId)
    c.set('log', base.child({ correlationId }))
    c.header(CORRELATION_ID_HEADER, correlationId)

    await correlationIds.run(correlationId, () => next())
  })
}
