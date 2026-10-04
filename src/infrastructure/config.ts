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
  objectStorage: {
    endpoint: string
    publicEndpoint: string
    bucket: string
    accessKeyId: string
    secretAccessKey: string
    uploadExpiresInSeconds: number
  }
  /** Where profile events go, and how to authenticate. Undefined while no subscriber is listed. */
  events: EventPublishingConfig | undefined
}

/** This service's own name, not a setting — a token is for us or it is for someone else. */
const AUDIENCE = 'profile-service'

const STORAGE_REQUIRED = [
  'OBJECT_STORAGE_ENDPOINT',
  'OBJECT_STORAGE_PUBLIC_ENDPOINT',
  'OBJECT_STORAGE_BUCKET',
  'OBJECT_STORAGE_ACCESS_KEY',
  'OBJECT_STORAGE_SECRET_KEY',
] as const

const REQUIRED = ['DATABASE_URL', 'IDENTITY_JWKS_URL', 'IDENTITY_ISSUER', ...STORAGE_REQUIRED] as const

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

/** How long a presigned upload URL stays valid. Long enough to upload, short enough to matter. */
function seconds(raw: string, problems: string[]): number {
  if (raw.length === 0) return 300
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 3_600) {
    problems.push(
      `OBJECT_STORAGE_UPLOAD_EXPIRES_SECONDS must be a whole number of seconds from 1 to 3600, not ${JSON.stringify(raw)}`,
    )
    return 300
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

export type ObjectStorageConfig = Config['objectStorage']

export type EventPublishingConfig = {
  subscribers: string[]
  identityTokenUrl: string
  clientId: string
  clientSecret: string
}

/**
 * ADR-0019: "Subscribers are listed in each publisher's configuration." None listed means
 * publishing is off — a clone, a laptop and the test suite run with no Buddy Discovery. Once one
 * is listed, the three Identity settings become required.
 */
function eventsFrom(env: Environment, problems: string[]): EventPublishingConfig | undefined {
  const subscribers = read(env, 'EVENT_SUBSCRIBERS')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
  const identityTokenUrl = read(env, 'IDENTITY_TOKEN_URL')
  const clientId = read(env, 'SERVICE_CLIENT_ID')
  const clientSecret = read(env, 'SERVICE_CLIENT_SECRET')
  if (subscribers.length === 0) return undefined

  const needed = { IDENTITY_TOKEN_URL: identityTokenUrl, SERVICE_CLIENT_ID: clientId, SERVICE_CLIENT_SECRET: clientSecret }
  for (const [name, value] of Object.entries(needed)) {
    if (value.length === 0) problems.push(`${name} is required when EVENT_SUBSCRIBERS is set`)
  }
  for (const subscriber of subscribers) {
    if (!URL.canParse(subscriber)) problems.push(`EVENT_SUBSCRIBERS must list URLs, not ${JSON.stringify(subscriber)}`)
    else problems.push(...httpProblems('EVENT_SUBSCRIBERS', subscriber))
  }
  if (identityTokenUrl.length > 0) {
    if (!URL.canParse(identityTokenUrl)) {
      problems.push(`IDENTITY_TOKEN_URL must be a URL, not ${JSON.stringify(identityTokenUrl)}`)
    } else problems.push(...httpProblems('IDENTITY_TOKEN_URL', identityTokenUrl))
  }
  return { subscribers, identityTokenUrl, clientId, clientSecret }
}

/**
 * A URL that parses is not yet one a POST can reach: `localhost:4100/events` parses, with
 * `localhost:` as its scheme. Refused here, at startup, rather than by every delivery after it.
 * Credentials are refused without being repeated, so the refusal cannot leak them into a log.
 */
function httpProblems(name: string, raw: string): string[] {
  const url = new URL(raw)
  const problems: string[] = []
  if (url.protocol !== 'http:' && url.protocol !== 'https:') problems.push(`${name} must use http or https, not ${url.protocol}`)
  if (url.username !== '' || url.password !== '') problems.push(`${name} must not carry credentials`)
  return problems
}

/** Events alone, for the seed — it publishes what it loads but has no use for an Identity JWKS. */
export function loadEventPublishing(env: Environment = process.env): EventPublishingConfig | undefined {
  const problems: string[] = []
  const events = eventsFrom(env, problems)
  if (problems.length > 0) throw new Error(`configuration: ${problems.join('; ')}`)
  return events
}

function objectStorageFrom(env: Environment, problems: string[]): ObjectStorageConfig {
  return {
    endpoint: read(env, 'OBJECT_STORAGE_ENDPOINT'),
    publicEndpoint: read(env, 'OBJECT_STORAGE_PUBLIC_ENDPOINT'),
    bucket: read(env, 'OBJECT_STORAGE_BUCKET'),
    accessKeyId: read(env, 'OBJECT_STORAGE_ACCESS_KEY'),
    secretAccessKey: read(env, 'OBJECT_STORAGE_SECRET_KEY'),
    uploadExpiresInSeconds: seconds(read(env, 'OBJECT_STORAGE_UPLOAD_EXPIRES_SECONDS'), problems),
  }
}

/** Storage alone, for the seed — it uploads avatars but has no use for an Identity setting. */
export function loadObjectStorage(env: Environment = process.env): ObjectStorageConfig {
  const problems = STORAGE_REQUIRED.filter((name) => read(env, name).length === 0).map(
    (name) => `${name} is required`,
  )
  const storage = objectStorageFrom(env, problems)
  if (problems.length > 0) throw new Error(`configuration: ${problems.join('; ')}`)
  return storage
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
  const storage = objectStorageFrom(env, problems)
  const events = eventsFrom(env, problems)

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
    objectStorage: storage,
    events,
  }
}
