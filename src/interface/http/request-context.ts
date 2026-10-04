import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { createMiddleware } from 'hono/factory'
import type { Logger } from 'pino'
import type { Env } from './context.ts'

const REQUEST_ID_HEADER = 'x-request-id'
const TRACE_ID = /^[0-9a-f]{32}$/

/** W3C traceparent: version-traceid-spanid-flags. The trace id is the part worth carrying. */
function traceId(traceparent: string | undefined): string | undefined {
  const candidate = traceparent?.split('-')[1]
  return candidate !== undefined && TRACE_ID.test(candidate) ? candidate : undefined
}

const requestIds = new AsyncLocalStorage<string>()

/**
 * The correlation id of the request being served, for code that never sees the request — the
 * profile-event publisher passes it on to the next service (NFR-7.4). Undefined outside one.
 *
 * `src/index.ts` hands this function to the publisher, so no layer imports across the rules.
 */
export function currentRequestId(): string | undefined {
  return requestIds.getStore()
}

/**
 * First in the chain: establishes the correlation id and the logger for this request.
 *
 * Every line written while serving the request carries the id, with no logger threaded
 * through call signatures. `hono/logger` exists but writes prose rather than JSON.
 */
export function requestContext(base: Logger) {
  return createMiddleware<Env>(async (c, next) => {
    // `||`, not `??`: an empty X-Request-Id is a header present with nothing in it, and an empty
    // id joins nothing — nor may it reach an event, whose contract requires at least one character.
    const requestId =
      traceId(c.req.header('traceparent')) || c.req.header(REQUEST_ID_HEADER)?.trim() || randomUUID()

    c.set('requestId', requestId)
    c.set('log', base.child({ requestId }))
    c.header(REQUEST_ID_HEADER, requestId)

    await requestIds.run(requestId, () => next())
  })
}
