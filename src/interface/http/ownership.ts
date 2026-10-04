import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import type { Env } from './context.ts'
import { ForbiddenError } from './errors.ts'

/**
 * The one comparison ownership rests on: the token's subject against the `userId` in the path.
 *
 * Refusing a write and choosing what a read shows both ask this, so it has one home — whatever
 * normalising `userId` one day needs happens here, for both at once.
 */
export function isOwner(c: Context<Env>): boolean {
  return c.get('caller').userId === c.req.param('userId')
}

/**
 * A runner may only write their own profile.
 *
 * Writes only: `openapi.yaml` gives 403 to PUT, PATCH and DELETE and not to GET, so any
 * authenticated caller may read any profile — though `isOwner` still decides what they see.
 */
export function ownsTheProfile() {
  return createMiddleware<Env>(async (c, next) => {
    if (!isOwner(c)) throw new ForbiddenError('a runner may only change their own profile')
    await next()
  })
}
