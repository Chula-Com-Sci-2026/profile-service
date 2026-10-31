import { SignJWT } from 'jose'
import type { AuthenticationOptions } from '../../src/interface/http/authentication.ts'

/**
 * A stand-in for the Identity Service, signing the way its `services/session.js` does: HS256
 * with the secret every service shares (ADR-0022), the team's issuer and audience, the runner's
 * id as the subject, fifteen minutes to live.
 *
 * The middleware does genuine verification against it; the only difference from the real stack
 * is a secret nobody else knows, so the suite needs no network.
 */

/** A key present with `undefined` removes that claim; an absent key keeps Identity's value. */
export type TokenChanges = {
  secret?: string
  alg?: 'HS256' | 'HS384'
  sub?: string | undefined
  iss?: string | undefined
  aud?: string | undefined
  exp?: number | undefined
}

export type Identity = {
  /** What the middleware is configured with. */
  settings: AuthenticationOptions
  /** A token as Identity issues one, for this runner. */
  tokenFor: (id: string) => Promise<string>
  /** `tokenFor`, with a claim, the algorithm or the key changed — for one edge at a time. */
  tokenWith: (id: string, changes: TokenChanges) => Promise<string>
}

const SECRET = 'a-secret-only-this-suite-knows'
const ISSUER = 'cant-run-alone-local'
const AUDIENCE = 'cant-run-alone-services'
const FIFTEEN_MINUTES = 15 * 60

export function anIdentity(): Identity {
  const tokenWith = (id: string, changes: TokenChanges): Promise<string> => {
    const { secret = SECRET, alg = 'HS256', ...claimChanges } = changes
    const claims: Record<string, unknown> = {
      sub: id,
      iss: ISSUER,
      aud: AUDIENCE,
      exp: Math.floor(Date.now() / 1000) + FIFTEEN_MINUTES,
      ...claimChanges,
    }
    for (const [name, value] of Object.entries(claims)) {
      if (value === undefined) delete claims[name]
    }
    return new SignJWT(claims).setProtectedHeader({ alg }).setIssuedAt().sign(new TextEncoder().encode(secret))
  }

  return {
    settings: { secret: SECRET, issuer: ISSUER, audience: AUDIENCE },
    tokenFor: (id) => tokenWith(id, {}),
    tokenWith,
  }
}
