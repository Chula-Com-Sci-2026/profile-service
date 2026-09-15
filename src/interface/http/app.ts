import { type Context, Hono } from 'hono'
import type { Logger } from 'pino'
import type { CreateProfile } from '../../application/create-profile.ts'
import type { DeleteProfile } from '../../application/delete-profile.ts'
import type { GetProfile } from '../../application/get-profile.ts'
import type { UpdateProfile } from '../../application/update-profile.ts'
import { authentication, type AuthenticationOptions } from './authentication.ts'
import type { Env } from './context.ts'
import { errorHandler, notFoundHandler } from './error-handler.ts'
import { MalformedBodyError } from './errors.ts'
import { ownsTheProfile } from './ownership.ts'
import { toChanges, toFields } from './profile-input.ts'
import { toView } from './profile-view.ts'
import { requestContext } from './request-context.ts'
import { profilePatch, profileWrite } from './validators.ts'

export type UseCases = {
  createProfile: CreateProfile
  getProfile: GetProfile
  updateProfile: UpdateProfile
  deleteProfile: DeleteProfile
}

/**
 * What `/ready` consults. Injected, so the HTTP layer knows nothing about pools or signals.
 */
export type Readiness = {
  isDraining: () => boolean
  canServe: () => Promise<boolean>
}

export type AppOptions = {
  useCases: UseCases
  logger: Logger
  authentication: AuthenticationOptions
  readiness: Readiness
}

const PROFILE = '/v1/profiles/:userId'

/**
 * Parse failures are raised where they happen. Matching `instanceof SyntaxError` in the error
 * handler would catch one thrown anywhere below the route — a driver, a dependency — and report
 * a server fault as a malformed body, skipping the only line that logs it.
 */
async function jsonBody(c: Context<Env>): Promise<unknown> {
  try {
    return await c.req.json()
  } catch {
    throw new MalformedBodyError('the body is not valid JSON')
  }
}

/**
 * Everything here comes from openapi.yaml.
 *
 * Order is error handler outermost, then request context, then auth, then routes — the only
 * arrangement in which the error handler can catch what the others throw. Auth is mounted on
 * `/v1/*`, not globally, so `/health` never reaches it: that mirrors the contract, where
 * `/health` is the one operation carrying `security: []`.
 */
export function createApp({ useCases, logger, authentication: auth, readiness }: AppOptions): Hono<Env> {
  const app = new Hono<Env>()

  app.onError(errorHandler(logger))
  app.notFound(notFoundHandler)
  app.use('*', requestContext(logger))
  app.use('/v1/*', authentication(auth))

  // Liveness: is the process wedged? It must keep answering 200 while draining, because the
  // orchestrator's answer to a failing liveness probe is to restart — the wrong response to a
  // deliberate shutdown.
  app.get('/health', (c) => c.json({ status: 'ok' }))

  // Readiness: should traffic come here? Unlike /health this does check the database, because
  // the answer to "not right now" is to route elsewhere, not to restart.
  app.get('/ready', async (c) => {
    if (readiness.isDraining()) return c.json({ status: 'draining' }, 503)
    return (await readiness.canServe()) ? c.json({ status: 'ready' }) : c.json({ status: 'unavailable' }, 503)
  })

  app.put(PROFILE, ownsTheProfile(), async (c) => {
    const body = profileWrite.parse(await jsonBody(c))
    const profile = await useCases.createProfile(toFields(c.req.param('userId'), body))
    return c.json(toView(profile), 201)
  })

  app.get(PROFILE, async (c) => {
    return c.json(toView(await useCases.getProfile(c.req.param('userId'))))
  })

  app.patch(PROFILE, ownsTheProfile(), async (c) => {
    const body = profilePatch.parse(await jsonBody(c))
    const profile = await useCases.updateProfile(c.req.param('userId'), toChanges(body))
    return c.json(toView(profile))
  })

  app.delete(PROFILE, ownsTheProfile(), async (c) => {
    await useCases.deleteProfile(c.req.param('userId'))
    return c.body(null, 204)
  })

  return app
}
