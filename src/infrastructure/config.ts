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
  identity: {
    jwksUrl: string
    issuer: string
    audience: string
  }
}

/** This service's own name, not a setting — a token is for us or it is for someone else. */
const AUDIENCE = 'profile-service'

const REQUIRED = ['DATABASE_URL', 'IDENTITY_JWKS_URL', 'IDENTITY_ISSUER'] as const

type Environment = Record<string, string | undefined>

function read(env: Environment, name: string): string {
  return (env[name] ?? '').trim()
}

function port(raw: string): number {
  if (raw.length === 0) return 3000
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`PORT must be a port number, not ${JSON.stringify(raw)}`)
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
  const missing = REQUIRED.filter((name) => read(env, name).length === 0)
  if (missing.length > 0) {
    throw new Error(`missing required configuration: ${missing.join(', ')}`)
  }

  return {
    nodeEnv: read(env, 'NODE_ENV') || 'development',
    port: port(read(env, 'PORT')),
    logLevel: read(env, 'LOG_LEVEL') || 'info',
    databaseUrl: read(env, 'DATABASE_URL'),
    identity: {
      jwksUrl: read(env, 'IDENTITY_JWKS_URL'),
      issuer: read(env, 'IDENTITY_ISSUER'),
      audience: AUDIENCE,
    },
  }
}
