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
  /** How Identity's access tokens are checked (ADR-0022): HS256 with the secret every service shares. */
  accessToken: {
    secret: string
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
}

/** The team's values, the same defaults Identity and Notification use. */
const DEFAULT_ISSUER = 'cant-run-alone-local'
const DEFAULT_AUDIENCE = 'cant-run-alone-services'

const STORAGE_REQUIRED = [
  'OBJECT_STORAGE_ENDPOINT',
  'OBJECT_STORAGE_PUBLIC_ENDPOINT',
  'OBJECT_STORAGE_BUCKET',
  'OBJECT_STORAGE_ACCESS_KEY',
  'OBJECT_STORAGE_SECRET_KEY',
] as const

const REQUIRED = ['DATABASE_URL', 'ACCESS_TOKEN_SECRET', ...STORAGE_REQUIRED] as const

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
 * refused for a missing token setting it will never use.
 */
export function loadDatabaseUrl(env: Environment = process.env): string {
  const url = read(env, 'DATABASE_URL')
  if (url.length === 0) throw new Error('missing required configuration: DATABASE_URL')
  return url
}

export type ObjectStorageConfig = Config['objectStorage']

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

/** Storage alone, for the seed — it uploads photos but has no use for a token setting. */
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

  if (problems.length > 0) {
    throw new Error(`configuration: ${problems.join('; ')}`)
  }

  return {
    nodeEnv: read(env, 'NODE_ENV') || 'development',
    port: listenOn,
    logLevel,
    databaseUrl: read(env, 'DATABASE_URL'),
    shutdownDrainMs: drainFor,
    accessToken: {
      secret: read(env, 'ACCESS_TOKEN_SECRET'),
      issuer: read(env, 'JWT_ISSUER') || DEFAULT_ISSUER,
      audience: read(env, 'JWT_AUDIENCE') || DEFAULT_AUDIENCE,
    },
    objectStorage: storage,
  }
}
