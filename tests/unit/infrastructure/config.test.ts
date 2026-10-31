import { describe, expect, it } from 'vitest'
import { loadConfig, loadDatabaseUrl, loadPhotoAddress } from '../../../src/infrastructure/config.ts'

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
  const rabbit = {
    EVENT_SENDER: 'rabbitmq',
    RABBITMQ_HOST: 'rabbitmq',
    RABBITMQ_USER: 'profile',
    RABBITMQ_PASSWORD: 'secret',
  }

  it('sends nothing by default — EVENT_SENDER is none, and no RabbitMQ setting is needed', () => {
    expect(loadConfig(complete).events).toEqual({ sender: 'none' })
    expect(loadConfig({ ...complete, EVENT_SENDER: 'none' }).events).toEqual({ sender: 'none' })
  })

  it('reads the RabbitMQ settings when EVENT_SENDER is rabbitmq, with port 5672 and vhost / by default', () => {
    expect(loadConfig({ ...complete, ...rabbit }).events).toEqual({
      sender: 'rabbitmq',
      rabbitmq: { host: 'rabbitmq', port: 5672, user: 'profile', password: 'secret', vhost: '/' },
    })
  })

  it('reads RABBITMQ_PORT and RABBITMQ_VHOST when they are set', () => {
    const events = loadConfig({ ...complete, ...rabbit, RABBITMQ_PORT: '5673', RABBITMQ_VHOST: 'cra' }).events
    expect(events).toMatchObject({ rabbitmq: { port: 5673, vhost: 'cra' } })
  })

  it('requires RABBITMQ_HOST, RABBITMQ_USER and RABBITMQ_PASSWORD when EVENT_SENDER is rabbitmq, named at once', () => {
    expect(() => loadConfig({ ...complete, EVENT_SENDER: 'rabbitmq' })).toThrow(
      /RABBITMQ_HOST is required when EVENT_SENDER is rabbitmq; RABBITMQ_USER is required.*; RABBITMQ_PASSWORD is required/,
    )
  })

  it('refuses an EVENT_SENDER it does not know', () => {
    expect(() => loadConfig({ ...complete, EVENT_SENDER: 'rest' })).toThrow(/EVENT_SENDER must be rabbitmq or none, not "rest"/)
  })

  it('refuses a RABBITMQ_PORT that is not a port', () => {
    expect(() => loadConfig({ ...complete, ...rabbit, RABBITMQ_PORT: '70000' })).toThrow(/RABBITMQ_PORT must be a port number/)
  })
})

describe('loadPhotoAddress', () => {
  it('asks only for the two settings a photo’s address needs', () => {
    expect(
      loadPhotoAddress({ OBJECT_STORAGE_PUBLIC_ENDPOINT: 'http://localhost:9000', OBJECT_STORAGE_BUCKET: 'profile-service' }),
    ).toEqual({ publicEndpoint: 'http://localhost:9000', bucket: 'profile-service' })
  })

  it('names both when they are missing', () => {
    expect(() => loadPhotoAddress({})).toThrow(/OBJECT_STORAGE_PUBLIC_ENDPOINT is required; OBJECT_STORAGE_BUCKET is required/)
  })
})
