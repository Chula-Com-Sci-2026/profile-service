import { createMiddleware } from 'hono/factory'
import { type JWTVerifyGetKey, jwtVerify } from 'jose'
import type { Env } from './context.ts'
import { UnauthorizedError } from './errors.ts'

export type AuthenticationOptions = {
  /** Identity's public keys. `createRemoteJWKSet` in production, a local set under test. */
  jwks: JWTVerifyGetKey
  issuer: string
  audience: string
}

const BEARER = /^Bearer (.+)$/

/**
 * Verifies Identity's JWT **locally** on every request — not trusted because a gateway
 * forwarded it. Verification is asymmetric on purpose: Identity signs, this service can only
 * check. A shared secret would let either mint tokens for the other.
 *
 * The token stops here. Routes, use cases and domain objects see a typed caller, never a header.
 */
export function authentication({ jwks, issuer, audience }: AuthenticationOptions) {
  return createMiddleware<Env>(async (c, next) => {
    const token = BEARER.exec(c.req.header('authorization') ?? '')?.[1]
    if (token === undefined) throw new UnauthorizedError('a bearer token is required')

    let subject: string | undefined
    try {
      const { payload } = await jwtVerify(token, jwks, { issuer, audience })
      subject = payload.sub
    } catch {
      // Why it failed — expired, wrong issuer, bad signature — is not the caller's business.
      throw new UnauthorizedError('the token did not verify')
    }

    if (subject === undefined || subject.length === 0) {
      throw new UnauthorizedError('the token carries no subject')
    }

    c.set('caller', { userId: subject })
    await next()
  })
}
