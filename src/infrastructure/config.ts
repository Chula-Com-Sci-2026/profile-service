/**
 * Configuration, read once at startup.
 *
 * A missing value fails here rather than on the first request that needs it — a service that
 * starts and then 500s on every call is harder to diagnose than one that refuses to start.
 * All of them are reported together, so a fresh environment takes one restart rather than three.
 *
 * Hand-rolled rather than Zod: the stack says Zod validates at the edge and nowhere else, and
 * this is infrastructure. The lint zones happen to permit it here; the rule still holds.
 */
export type Config = {
  nodeEnv: string
  port: number
  logLevel: string
  databaseUrl: string
  /**
   * How long `/ready` answers 503 before the server stops accepting, so whatever routes
   * traffic has time to notice. Zero by default: nothing polls in development, and a wait
   * on every Ctrl-C is a worse daily cost than a brief refusal during a deploy.
   */
  shutdownDrainMs: number
  identity: {
    jwksUrl: string
    issuer: string
    audience: string
  }
}

/** This service's own name, not a setting — a token is for us or it is for someone else. */
const AUDIENCE = 'profile-service'

const REQUIRED = ['DATABASE_URL', 'IDENTITY_JWKS_URL', 'IDENTITY_ISSUER'] as const

/** pino's levels. Checked here so a typo fails with the rest, not later inside pino. */
const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'] as const

type Environment = Record<string, string | undefined>

function read(env: Environment, name: string): string {
  return (env[name] ?? '').trim()
}

// These collect rather than throw: a value that is present but wrong is a problem like any
// other, and the point of this module is that you learn about all of them in one restart.
function milliseconds(raw: string, name: string, fallback: number, problems: string[]): number {
  if (raw.length === 0) return fallback
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 60_000) {
    problems.push(`${name} must be a whole number of milliseconds from 0 to 60000, not ${JSON.stringify(raw)}`)
    return fallback
  }
  return parsed
}

function port(raw: string, problems: string[]): number {
  if (raw.length === 0) return 3000
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    problems.push(`PORT must be a port number, not ${JSON.stringify(raw)}`)
    return 3000
  }
  return parsed
}

/**
 * Just the database, for tools that touch it and nothing else — the seed script should not be
 * refused for a missing Identity setting it will never use.
 */
export function loadDatabaseUrl(env: Environment = process.env): string {
  const url = read(env, 'DATABASE_URL')
  if (url.length === 0) throw new Error('missing required configuration: DATABASE_URL')
  return url
}

export function loadConfig(env: Environment = process.env): Config {
  const problems = REQUIRED.filter((name) => read(env, name).length === 0).map(
    (name) => `${name} is required`,
  )

  const logLevel = read(env, 'LOG_LEVEL') || 'info'
  if (!(LOG_LEVELS as readonly string[]).includes(logLevel)) {
    problems.push(`LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}, not ${JSON.stringify(logLevel)}`)
  }

  const listenOn = port(read(env, 'PORT'), problems)
  const drainFor = milliseconds(read(env, 'SHUTDOWN_DRAIN_MS'), 'SHUTDOWN_DRAIN_MS', 0, problems)

  if (problems.length > 0) {
    throw new Error(`configuration: ${problems.join('; ')}`)
  }

  return {
    nodeEnv: read(env, 'NODE_ENV') || 'development',
    port: listenOn,
    logLevel,
    databaseUrl: read(env, 'DATABASE_URL'),
    shutdownDrainMs: drainFor,
    identity: {
      jwksUrl: read(env, 'IDENTITY_JWKS_URL'),
      issuer: read(env, 'IDENTITY_ISSUER'),
      audience: AUDIENCE,
    },
  }
}
