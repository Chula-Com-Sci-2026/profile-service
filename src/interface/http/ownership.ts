import { createMiddleware } from 'hono/factory'
import type { Env } from './context.ts'
import { ForbiddenError } from './errors.ts'

/**
 * A runner may only write their own profile — one comparison, caller against the path.
 *
 * Writes only: `openapi.yaml` gives 403 to PUT, PATCH and DELETE and not to GET, so any
 * authenticated caller may read any profile.
 */
export function ownsTheProfile() {
  return createMiddleware<Env>(async (c, next) => {
    if (c.get('caller').userId !== c.req.param('userId')) {
      throw new ForbiddenError('a runner may only change their own profile')
    }
    await next()
  })
}
