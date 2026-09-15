import { serve } from '@hono/node-server'
import { pino } from 'pino'
import { createProfile } from './application/create-profile.ts'
import { deleteProfile } from './application/delete-profile.ts'
import { getProfile } from './application/get-profile.ts'
import { updateProfile } from './application/update-profile.ts'
import { loadConfig } from './infrastructure/config.ts'
import { createDatabase } from './infrastructure/database.ts'
import { DrizzleProfileRepository } from './infrastructure/drizzle-profile-repository.ts'
import { createApp } from './interface/http/app.ts'
import { remoteIdentityKeys } from './interface/http/authentication.ts'

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

/** Flipped before anything stops accepting, so /ready answers 503 first. */
let draining = false

const app = createApp({
  useCases: {
    createProfile: createProfile(repository),
    getProfile: getProfile(repository),
    updateProfile: updateProfile(repository),
    deleteProfile: deleteProfile(repository),
  },
  logger,
  authentication: {
    jwks: remoteIdentityKeys(config.identity.jwksUrl),
    issuer: config.identity.issuer,
    audience: config.identity.audience,
  },
  readiness: { isDraining: () => draining, canServe: () => database.ping() },
})

const server = serve({ fetch: app.fetch, port: config.port }, ({ port }) => {
  logger.info({ port, nodeEnv: config.nodeEnv }, 'profile-service listening')
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
const SHUTDOWN_DEADLINE_MS = 10_000

async function shutdown(signal: string): Promise<void> {
  if (draining) return
  // First, so /ready answers 503 before the server stops accepting. The grace window between
  // the two belongs to the orchestrator — a preStop delay — not to a sleep baked in here,
  // which would slow every Ctrl-C in development.
  draining = true
  logger.info({ signal }, 'shutting down')

  // Give up rather than hang: a process that will not exit is worse than one that exits badly.
  const deadline = setTimeout(() => {
    logger.error({ deadlineMs: SHUTDOWN_DEADLINE_MS }, 'shutdown took too long, exiting anyway')
    process.exit(1)
  }, SHUTDOWN_DEADLINE_MS)
  deadline.unref()

  server.close(() => {
    void database.end().then(
      () => process.exit(0),
      (error: unknown) => {
        logger.error({ err: error }, 'the pool did not close cleanly')
        process.exit(1)
      },
    )
  })
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
