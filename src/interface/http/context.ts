import type { Logger } from 'pino'

/** Who is asking. Produced by the auth middleware from the token's subject, never from a header. */
export type Caller = { userId: string }

/** What middleware puts on the request. No route, use case or domain object sees a header or a token. */
export type Variables = {
  requestId: string
  log: Logger
  caller: Caller
}

export type Env = { Variables: Variables }
