import { setTimeout as delay } from 'node:timers/promises'
import { serve } from '@hono/node-server'
import { pino } from 'pino'
import { attachPhoto } from './application/attach-photo.ts'
import { createPhotoUpload } from './application/create-photo-upload.ts'
import { getProfile } from './application/get-profile.ts'
import { getPublicProfile } from './application/get-public-profile.ts'
import type { Publishing } from './application/publishing.ts'
import { removePhoto } from './application/remove-photo.ts'
import { saveProfile } from './application/save-profile.ts'
import { setFieldVisibility } from './application/set-field-visibility.ts'
import { loadConfig } from './infrastructure/config.ts'
import { createDatabase } from './infrastructure/database.ts'
import { DrizzleProfileRepository } from './infrastructure/drizzle-profile-repository.ts'
import { httpProfileEvents, logUndelivered } from './infrastructure/http-profile-events.ts'
import { identityServiceTokens } from './infrastructure/identity-service-tokens.ts'
import { logOrphan } from './infrastructure/log-orphan.ts'
import { createPhotoStorage } from './infrastructure/minio-photo-storage.ts'
import { photoUrlFor } from './infrastructure/photo-url.ts'
import { silentProfileEvents } from './infrastructure/silent-profile-events.ts'
import { createApp } from './interface/http/app.ts'
import { currentCorrelationId } from './interface/http/request-context.ts'

/**
 * The composition root — the one file that knows every layer exists.
 *
 * Everything below depends on an interface; something has to pick the implementations and
 * connect them, and that cannot be any of the layers without breaking the rule they follow.
 * This is the exception, and it is deliberately the only one.
 */
const config = loadConfig()

const logger = pino({
  level: config.logLevel,
  // A bearer token must never reach a log line, wherever it is attached.
  redact: ['req.headers.authorization', 'headers.authorization', 'authorization'],
})

const database = createDatabase(config.databaseUrl, (error) => {
  // An idle connection failing is not a request failing — log it and let the pool recover.
  logger.error({ err: error }, 'an idle database connection failed')
})
const repository = new DrizzleProfileRepository(database.db)

/**
 * Photos live in object storage. Building the clients asks storage nothing, so a store that is
 * down costs the photo routes and nothing else — not startup, not /ready, not a read.
 */
const photos = createPhotoStorage(config.objectStorage)
/** A photo's public address, from its key. Whatever serialises a card is handed this. */
const photoUrl = photoUrlFor(config.objectStorage)
/** A replaced or removed photo storage would not delete — logged and tolerated, see logOrphan. */
const onOrphan = logOrphan(logger, currentCorrelationId, 'a photo object was orphaned')

/**
 * Profile events to Buddy Discovery (ADR-0019): REST now, a broker later, behind one port.
 * Off while no subscriber is configured, so a clone runs with nobody to tell.
 */
const events =
  config.events === undefined
    ? silentProfileEvents
    : httpProfileEvents({
        subscribers: config.events.subscribers,
        tokens: identityServiceTokens({
          tokenUrl: config.events.identityTokenUrl,
          clientId: config.events.clientId,
          clientSecret: config.events.clientSecret,
        }),
        currentCorrelationId,
        photoUrl,
      })
if (config.events === undefined) logger.info('no EVENT_SUBSCRIBERS configured: profile events are not published')

const publishing: Publishing = { events, onUndelivered: logUndelivered(logger, currentCorrelationId) }

/** Flipped before anything stops accepting, so /ready answers 503 first. */
let draining = false

const app = createApp({
  useCases: {
    saveProfile: saveProfile(repository, publishing),
    getProfile: getProfile(repository),
    getPublicProfile: getPublicProfile(repository),
    setFieldVisibility: setFieldVisibility(repository, publishing),
    createPhotoUpload: createPhotoUpload(repository, photos),
    attachPhoto: attachPhoto(repository, photos, onOrphan, publishing),
    removePhoto: removePhoto(repository, photos, onOrphan, publishing),
  },
  logger,
  authentication: config.accessToken,
  readiness: { isDraining: () => draining, canServe: () => database.ping() },
  photoUrl,
})

/** How long the close may take once draining is over. The drain is budgeted separately. */
const SHUTDOWN_DEADLINE_MS = 10_000

const server = serve({ fetch: app.fetch, port: config.port }, ({ port }) => {
  // The shutdown budget is logged because the container's grace period has to exceed it —
  // `docker stop -t` or terminationGracePeriodSeconds — and nothing in here can check that.
  logger.info(
    {
      port,
      nodeEnv: config.nodeEnv,
      shutdownBudgetMs: config.shutdownDrainMs + SHUTDOWN_DEADLINE_MS,
    },
    'profile-service listening',
  )
})

// A bind failure arrives as an event, not a throw. Without this the operator gets a stack
// trace where loadConfig would have given them a sentence.
server.on('error', (error: Error) => {
  logger.error({ err: error, port: config.port }, 'the server could not start')
  process.exit(1)
})

/**
 * Docker signals PID 1, and Node installs no default handler there, so without this
 * `docker stop` waits ten seconds and then kills the process mid-request.
 */

async function shutdown(signal: string): Promise<void> {
  if (draining) {
    // The drain is a multi-second window in which the default handler is already replaced, so
    // without this a second Ctrl-C would do nothing and the operator would have no way out.
    logger.warn({ signal }, 'already shutting down — exiting now')
    process.exit(1)
  }

  // First, so /ready answers 503 while the server is still accepting. Without a pause here the
  // 503 is unobservable — the socket closes in the same tick — and whatever routes traffic
  // keeps sending it. Zero by default, so Ctrl-C stays instant in development.
  draining = true
  logger.info({ signal, drainMs: config.shutdownDrainMs }, 'draining')
  if (config.shutdownDrainMs > 0) await delay(config.shutdownDrainMs)

  logger.info('no longer accepting connections')

  // Give up rather than hang: a process that will not exit is worse than one that exits badly.
  // The deadline covers the close, not the drain, so the two cannot fight over one budget.
  const deadline = setTimeout(() => {
    logger.error({ deadlineMs: SHUTDOWN_DEADLINE_MS }, 'shutdown took too long, exiting anyway')
    process.exit(1)
  }, SHUTDOWN_DEADLINE_MS)
  deadline.unref()

  // close() waits for connections to end; this evicts the idle keep-alive ones a load balancer
  // is likely holding, which otherwise sit until keepAliveTimeout and can burn the deadline.
  server.close(() => {
    void database.end().then(
      () => process.exit(0),
      (error: unknown) => {
        logger.error({ err: error }, 'the pool did not close cleanly')
        process.exit(1)
      },
    )
  })
  // Hono's ServerType covers HTTP/2 too, which has no such method — ask rather than assert.
  if ('closeIdleConnections' in server) server.closeIdleConnections()
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
