import { createMiddleware } from 'hono/factory'
import { jwtVerify } from 'jose'
import type { Env } from './context.ts'
import { UnauthorizedError } from './errors.ts'
import { isUuid } from './uuid.ts'

export type AuthenticationOptions = {
  /** The secret Identity signs access tokens with, shared by every service (ADR-0022). */
  secret: string
  issuer: string
  audience: string
}

// RFC 9110 §11.1: the auth scheme is case-insensitive, whatever a proxy does to it.
const BEARER = /^Bearer (.+)$/i

/**
 * Verifies Identity's access token **locally** on every request — not trusted because a gateway
 * forwarded it. The same check as Identity's own middleware and Notification's: HS256 only, the
 * shared secret as UTF-8 bytes, the configured issuer and audience, and `exp`, `iss`, `aud` and
 * `sub` all present. Without a required `exp` a token would verify forever, and this service has
 * no revocation path.
 *
 * The token stops here. Routes, use cases and domain objects see a typed caller, never a header.
 */
export function authentication({ secret, issuer, audience }: AuthenticationOptions) {
  const key = new TextEncoder().encode(secret)

  return createMiddleware<Env>(async (c, next) => {
    const token = BEARER.exec(c.req.header('authorization') ?? '')?.[1]
    if (token === undefined) throw new UnauthorizedError('a bearer token is required')

    let subject: string | undefined
    try {
      const { payload } = await jwtVerify(token, key, {
        algorithms: ['HS256'],
        issuer,
        audience,
        requiredClaims: ['exp', 'iss', 'aud', 'sub'],
      })
      subject = payload.sub
    } catch {
      // Why it failed — expired, wrong issuer, bad signature — is not the caller's business.
      throw new UnauthorizedError('the token did not verify')
    }

    // Every id in the team is a UUID; Identity's subject is its users.id.
    if (subject === undefined || !isUuid(subject)) {
      throw new UnauthorizedError('the token does not name a runner')
    }

    // Lowercase, so one runner is one id however a token spells it.
    c.set('caller', { id: subject.toLowerCase() })
    await next()
  })
}
