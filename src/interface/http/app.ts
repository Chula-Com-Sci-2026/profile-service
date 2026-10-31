import { type Context, Hono } from 'hono'
import type { Logger } from 'pino'
import type { AttachPhoto } from '../../application/attach-photo.ts'
import type { CreatePhotoUpload } from '../../application/create-photo-upload.ts'
import type { GetProfile } from '../../application/get-profile.ts'
import type { GetPublicProfile } from '../../application/get-public-profile.ts'
import type { RemovePhoto } from '../../application/remove-photo.ts'
import type { SaveProfile } from '../../application/save-profile.ts'
import type { SetFieldVisibility } from '../../application/set-field-visibility.ts'
import { authentication, type AuthenticationOptions } from './authentication.ts'
import type { Env } from './context.ts'
import { contractDocument, documentationAsset, documentationPage } from './docs.ts'
import { errorHandler, notFoundHandler } from './error-handler.ts'
import { MalformedBodyError } from './errors.ts'
import { toContent, toHiddenFields } from './profile-input.ts'
import { cardView, ownerView, type PhotoUrl } from './profile-view.ts'
import { requestContext } from './request-context.ts'
import { photoAttachment, profileSave, visibility } from './validators.ts'

export type UseCases = {
  saveProfile: SaveProfile
  getProfile: GetProfile
  getPublicProfile: GetPublicProfile
  setFieldVisibility: SetFieldVisibility
  createPhotoUpload: CreatePhotoUpload
  attachPhoto: AttachPhoto
  removePhoto: RemovePhoto
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
  /** A photo's public address, from its key — the domain never sees it (domain.md §2 "Photo"). */
  photoUrl: PhotoUrl
}

/** The caller's own profile: "me" is the token's subject, so there is nobody else's to reach. */
const ME = '/api/v1/me/profile'

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
 * `/api/v1/*`, not globally, so `/up` never reaches it: that mirrors the contract, where
 * `/up` carries `security: []`.
 */
export function createApp({ useCases, logger, authentication: auth, readiness, photoUrl }: AppOptions): Hono<Env> {
  const app = new Hono<Env>()

  app.onError(errorHandler(logger))
  app.notFound(notFoundHandler)
  app.use('*', requestContext(logger))
  app.use('/api/v1/*', authentication(auth))

  // Liveness: is the process wedged? It must keep answering 200 while draining, because the
  // orchestrator's answer to a failing liveness probe is to restart — the wrong response to a
  // deliberate shutdown.
  app.get('/up', (c) => c.json({ status: 'ok' }))

  // Readiness: should traffic come here? Unlike /up this does check the database, because
  // the answer to "not right now" is to route elsewhere, not to restart.
  app.get('/ready', async (c) => {
    if (readiness.isDraining()) return c.json({ status: 'draining' }, 503)
    // openapi.yaml documents 200 and 503 for this operation and no default, so a probe that
    // throws must not become a 500. The guarantee belongs here, not in whatever was injected.
    const serving = await readiness.canServe().catch(() => false)
    return serving ? c.json({ status: 'ready' }) : c.json({ status: 'unavailable' }, 503)
  })

  // The contract, served by the service it describes — outside /v1 because it is not a profile
  // operation, and open because it is documentation.
  app.get('/docs', documentationPage)
  app.get('/docs/:asset', documentationAsset)
  app.get('/openapi.yaml', contractDocument())

  app.get(ME, async (c) => {
    return c.json(ownerView(await useCases.getProfile(c.get('caller').id), photoUrl))
  })

  // Creates or replaces, and answers 200 either way: the client cannot tell, and need not.
  app.put(ME, async (c) => {
    const body = profileSave.parse(await jsonBody(c))
    return c.json(ownerView(await useCases.saveProfile(c.get('caller').id, toContent(body)), photoUrl))
  })

  // Its own operation, so a save can never reveal a field (domain.md §3).
  app.put(`${ME}/visibility`, async (c) => {
    const body = visibility.parse(await jsonBody(c))
    return c.json(ownerView(await useCases.setFieldVisibility(c.get('caller').id, toHiddenFields(body)), photoUrl))
  })

  // The resource created here is the *permission*, not the photo — which is why the path is
  // photo-uploads and why nothing here accepts image bytes. The runner attaches the key once the
  // upload succeeds, so a failed upload leaves nothing pointing at a missing object.
  app.post(`${ME}/photo-uploads`, async (c) => {
    return c.json(await useCases.createPhotoUpload(c.get('caller').id), 201)
  })

  app.put(`${ME}/photo`, async (c) => {
    const body = photoAttachment.parse(await jsonBody(c))
    return c.json(ownerView(await useCases.attachPhoto(c.get('caller').id, body.photoRef), photoUrl))
  })

  app.delete(`${ME}/photo`, async (c) => {
    return c.json(ownerView(await useCases.removePhoto(c.get('caller').id), photoUrl))
  })

  // The card, to anyone — its owner included, so a runner sees exactly what others see. Ids are
  // compared in lowercase, as a token's subject is.
  app.get('/api/v1/runners/:id', async (c) => {
    return c.json(cardView(await useCases.getPublicProfile(c.req.param('id').toLowerCase()), photoUrl))
  })

  return app
}
