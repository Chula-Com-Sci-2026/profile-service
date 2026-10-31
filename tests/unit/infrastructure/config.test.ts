import { describe, expect, it } from 'vitest'
import { loadConfig, loadDatabaseUrl, loadEventPublishing } from '../../../src/infrastructure/config.ts'

const complete = {
  DATABASE_URL: 'postgres://profile:profile@localhost:5432/profile',
  ACCESS_TOKEN_SECRET: 'replace-with-local-access-signing-secret',
  OBJECT_STORAGE_ENDPOINT: 'http://minio:9000',
  OBJECT_STORAGE_PUBLIC_ENDPOINT: 'http://localhost:9000',
  OBJECT_STORAGE_BUCKET: 'profile-service',
  OBJECT_STORAGE_ACCESS_KEY: 'minioadmin',
  OBJECT_STORAGE_SECRET_KEY: 'minioadmin',
}

describe('loadConfig — what it requires', () => {
  it('reports every missing value at once, so a fresh environment costs one restart', () => {
    expect(() => loadConfig({})).toThrow(
      /DATABASE_URL is required; ACCESS_TOKEN_SECRET is required/,
    )
  })

  it('treats whitespace as missing', () => {
    expect(() => loadConfig({ ...complete, DATABASE_URL: '   ' })).toThrow(/DATABASE_URL is required/)
  })

  it('accepts a complete environment', () => {
    const config = loadConfig(complete)
    expect(config.databaseUrl).toBe(complete.DATABASE_URL)
    expect(config.accessToken.secret).toBe('replace-with-local-access-signing-secret')
  })
})

describe('loadConfig — defaults', () => {
  it('fills in the ones that have sensible answers', () => {
    const config = loadConfig(complete)
    expect(config.nodeEnv).toBe('development')
    expect(config.port).toBe(3000)
    expect(config.logLevel).toBe('info')
    expect(config.shutdownDrainMs).toBe(0)
    expect(config.objectStorage.uploadExpiresInSeconds).toBe(300)
  })

  it('keeps the two storage endpoints apart — a presigned URL is signed over its host', () => {
    const config = loadConfig(complete)
    expect(config.objectStorage.endpoint).toBe('http://minio:9000')
    expect(config.objectStorage.publicEndpoint).toBe('http://localhost:9000')
  })

  it('checks tokens against the team\u2019s issuer and audience unless told otherwise', () => {
    expect(loadConfig(complete).accessToken).toEqual({
      secret: 'replace-with-local-access-signing-secret',
      issuer: 'cant-run-alone-local',
      audience: 'cant-run-alone-services',
    })
  })

  it('reads JWT_ISSUER and JWT_AUDIENCE when they are set', () => {
    const { accessToken } = loadConfig({ ...complete, JWT_ISSUER: 'issuer-x', JWT_AUDIENCE: 'audience-y' })
    expect(accessToken.issuer).toBe('issuer-x')
    expect(accessToken.audience).toBe('audience-y')
  })
})

describe('loadConfig — values it refuses', () => {
  it.each(['warning', 'verbose', 'INFO'])('rejects LOG_LEVEL=%s and names the valid ones', (level) => {
    expect(() => loadConfig({ ...complete, LOG_LEVEL: level })).toThrow(
      /LOG_LEVEL must be one of trace, debug, info, warn, error, fatal, silent/,
    )
  })

  it.each(['0', '70000', 'http', '3000.5'])('rejects PORT=%s', (port) => {
    expect(() => loadConfig({ ...complete, PORT: port })).toThrow(/PORT must be a port number/)
  })

  it.each(['-1', '60001', 'soon'])('rejects SHUTDOWN_DRAIN_MS=%s', (drain) => {
    expect(() => loadConfig({ ...complete, SHUTDOWN_DRAIN_MS: drain })).toThrow(/SHUTDOWN_DRAIN_MS/)
  })

  it.each(['0', '3601', 'later'])('rejects OBJECT_STORAGE_UPLOAD_EXPIRES_SECONDS=%s', (window) => {
    expect(() =>
      loadConfig({ ...complete, OBJECT_STORAGE_UPLOAD_EXPIRES_SECONDS: window }),
    ).toThrow(/OBJECT_STORAGE_UPLOAD_EXPIRES_SECONDS/)
  })

  it.each(['OBJECT_STORAGE_ENDPOINT', 'OBJECT_STORAGE_BUCKET', 'OBJECT_STORAGE_SECRET_KEY'])(
    'requires %s',
    (name) => {
      expect(() => loadConfig({ ...complete, [name]: '' })).toThrow(new RegExp(`${name} is required`))
    },
  )

  it('accepts a drain of zero — that is the default, not an omission', () => {
    expect(loadConfig({ ...complete, SHUTDOWN_DRAIN_MS: '0' }).shutdownDrainMs).toBe(0)
  })
})

describe('loadConfig — one restart, not several', () => {
  it('reports a present-but-wrong value alongside a missing one', () => {
    const message = (() => {
      try {
        loadConfig({ DATABASE_URL: 'x', LOG_LEVEL: 'warning', PORT: '0', SHUTDOWN_DRAIN_MS: 'soon' })
        return ''
      } catch (error) {
        return (error as Error).message
      }
    })()

    expect(message).toContain('ACCESS_TOKEN_SECRET is required')
    expect(message).toContain('LOG_LEVEL must be one of')
    expect(message).toContain('PORT must be a port number')
    expect(message).toContain('SHUTDOWN_DRAIN_MS must be a whole number')
  })
})

describe('loadDatabaseUrl', () => {
  it('asks for nothing else, so the seed is not refused over the token secret', () => {
    expect(loadDatabaseUrl({ DATABASE_URL: 'postgres://x' })).toBe('postgres://x')
  })

  it('still refuses without one', () => {
    expect(() => loadDatabaseUrl({})).toThrow(/DATABASE_URL/)
  })
})

describe('loadConfig — profile events', () => {
  const publishing = {
    EVENT_SUBSCRIBERS: 'http://discovery:4100/internal/events',
    IDENTITY_TOKEN_URL: 'http://identity:4000/oauth/token',
    SERVICE_CLIENT_ID: 'profile-service',
    SERVICE_CLIENT_SECRET: 'secret',
  }

  it('is off when no subscriber is listed — a clone runs with no Buddy Discovery', () => {
    expect(loadConfig(complete).events).toBeUndefined()
  })

  it('reads the subscribers and Identity credentials once a subscriber is listed', () => {
    expect(loadConfig({ ...complete, ...publishing }).events).toEqual({
      subscribers: ['http://discovery:4100/internal/events'],
      identityTokenUrl: 'http://identity:4000/oauth/token',
      clientId: 'profile-service',
      clientSecret: 'secret',
    })
  })

  it('trims each subscriber and drops empty entries', () => {
    const events = loadConfig({ ...complete, ...publishing, EVENT_SUBSCRIBERS: ' http://a.test/e , ,http://b.test/e ' }).events
    expect(events?.subscribers).toEqual(['http://a.test/e', 'http://b.test/e'])
  })

  it('requires the token URL and credentials once a subscriber is listed, all named at once', () => {
    expect(() => loadConfig({ ...complete, EVENT_SUBSCRIBERS: publishing.EVENT_SUBSCRIBERS })).toThrow(
      /IDENTITY_TOKEN_URL is required when EVENT_SUBSCRIBERS is set; SERVICE_CLIENT_ID is required when EVENT_SUBSCRIBERS is set; SERVICE_CLIENT_SECRET is required when EVENT_SUBSCRIBERS is set/,
    )
  })

  it('refuses a subscriber that is not a URL', () => {
    expect(() => loadConfig({ ...complete, ...publishing, EVENT_SUBSCRIBERS: 'discovery' })).toThrow(
      /EVENT_SUBSCRIBERS must list URLs, not "discovery"/,
    )
  })

  it.each(['buddy-discovery:8080/internal/events', 'localhost:4100/events', 'ftp://discovery/events'])(
    'refuses %s — it parses as a URL, but no POST could ever reach it',
    (subscriber) => {
      expect(() => loadConfig({ ...complete, ...publishing, EVENT_SUBSCRIBERS: subscriber })).toThrow(
        /EVENT_SUBSCRIBERS must use http or https/,
      )
    },
  )

  it('refuses credentials in a URL, without repeating them', () => {
    const attempt = () => loadConfig({ ...complete, ...publishing, IDENTITY_TOKEN_URL: 'http://user:hunter2@identity/token' })
    expect(attempt).toThrow(/IDENTITY_TOKEN_URL must not carry credentials/)
    expect(attempt).not.toThrow(/hunter2/)
  })

  it('is loadable on its own, for the seed', () => {
    expect(loadEventPublishing({})).toBeUndefined()
    expect(loadEventPublishing(publishing)?.clientId).toBe('profile-service')
    expect(() => loadEventPublishing({ EVENT_SUBSCRIBERS: publishing.EVENT_SUBSCRIBERS })).toThrow(/IDENTITY_TOKEN_URL is required/)
  })
})
