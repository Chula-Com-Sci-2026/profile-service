import { readFileSync } from 'node:fs'
import { sql } from 'drizzle-orm'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Hono } from 'hono'
import pg from 'pg'
import { pino } from 'pino'
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest'
import { createAvatarUpload } from '../../src/application/create-avatar-upload.ts'
import { createProfile } from '../../src/application/create-profile.ts'
import { deleteProfile } from '../../src/application/delete-profile.ts'
import { getProfile } from '../../src/application/get-profile.ts'
import { updateProfile } from '../../src/application/update-profile.ts'
import { DrizzleProfileRepository } from '../../src/infrastructure/drizzle-profile-repository.ts'
import { createApp } from '../../src/interface/http/app.ts'
import type { Env } from '../../src/interface/http/context.ts'
import { contractDocument } from '../../src/interface/http/docs.ts'
import { errorHandler } from '../../src/interface/http/error-handler.ts'
import { currentRequestId } from '../../src/interface/http/request-context.ts'
import { documentedResponses, exercised, expectContract } from './contract.ts'
import { RecordingProfileEvents } from '../unit/application/profile-events-double.ts'
import { anIdentity, type Identity } from './identity.ts'

const alwaysReady = { isDraining: () => false, canServe: () => Promise.resolve(true) }

/** The contract tests are about HTTP shape; the real adapter is exercised through compose. */
const storage = {
  authoriseUpload: (userId: string) =>
    Promise.resolve({
      uploadUrl: `http://localhost:9000/avatars/${userId}/abc?X-Amz-Signature=x`,
      avatarRef: `avatars/${userId}/abc`,
      expiresInSeconds: 300,
    }),
  remove: () => Promise.resolve(),
  removeAll: () => Promise.resolve(),
}

const NOK = '7f3a9c2e15'
const BEAM = 'b41d8e0a63'

let pool: pg.Pool
let db: NodePgDatabase
let app: Hono<Env>
let identity: Identity
/** What the app published during the current test; reset before each. */
let events: RecordingProfileEvents
const undelivered: string[] = []
let requestIdWhenPublished: string | undefined

/** Reads `events` at call time, so each test sees a fresh recorder. */
const publishing = () => ({
  events: {
    updated: (profile: Parameters<RecordingProfileEvents['updated']>[0]) => {
      requestIdWhenPublished = currentRequestId()
      return events.updated(profile)
    },
    deleted: (userId: string) => events.deleted(userId),
  },
  onUndelivered: (userId: string) => {
    undelivered.push(userId)
  },
})

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: inject('databaseUrl') })
  db = drizzle(pool)
  identity = await anIdentity()
  const repository = new DrizzleProfileRepository(db)
  events = new RecordingProfileEvents()

  app = createApp({
    useCases: {
      createProfile: createProfile(repository, publishing()),
      getProfile: getProfile(repository),
      updateProfile: updateProfile(repository, storage, () => {}, publishing()),
      deleteProfile: deleteProfile(repository, storage, () => {}, publishing()),
      createAvatarUpload: createAvatarUpload(repository, storage),
    },
    logger: pino({ level: 'silent' }),
    authentication: { jwks: identity.jwks, issuer: identity.issuer, audience: identity.audience },
    readiness: {
      isDraining: () => false,
      canServe: async () => {
        try {
          await db.execute(sql`SELECT 1`)
          return true
        } catch {
          return false
        }
      },
    },
  })
})

afterAll(async () => {
  await pool.end()
})

beforeEach(async () => {
  await db.execute(sql`TRUNCATE profiles`)
  events = new RecordingProfileEvents()
  undelivered.length = 0
  requestIdWhenPublished = undefined
})

const minimal = { displayName: 'Nok', birthYear: 1994, area: { latitude: 13.7314, longitude: 100.5414 } }
/** `minimal.area`'s cell. */
const minimalCell = { latitude: 13.73, longitude: 100.54 }

async function as(userId: string, path: string, init: RequestInit = {}): Promise<Response> {
  const token = await identity.tokenFor(userId)
  return app.request(path, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...init.headers },
  })
}

const put = (userId: string, body: unknown, as_ = userId): Promise<Response> =>
  as(as_, `/v1/profiles/${userId}`, { method: 'PUT', body: JSON.stringify(body) })

async function givenAProfile(userId = NOK, body: unknown = minimal): Promise<void> {
  const response = await put(userId, body)
  expect(response.status).toBe(201)
}

describe('PUT /v1/profiles/{userId} — createProfile', () => {
  it('201 creates the profile', async () => {
    const response = await put(NOK, { ...minimal, bio: 'Chasing a sub-2 half.', pace: 330 })
    await expectContract('createProfile', 201, response)
  })

  it('201 leaves an unset scalar absent and an unset set empty', async () => {
    const response = await put(NOK, minimal)
    const body = (await response.clone().json()) as Record<string, unknown>
    await expectContract('createProfile', 201, response)

    expect('bio' in body).toBe(false)
    expect(body['preferredDistances']).toEqual([])
  })

  it('201 answers the owner with the exact area and its cell', async () => {
    const response = await put(NOK, { ...minimal, area: { latitude: 13.73172, longitude: 100.54153 } })
    const body = (await response.clone().json()) as Record<string, unknown>
    await expectContract('createProfile', 201, response)

    expect(body['area']).toEqual({ latitude: 13.73172, longitude: 100.54153 })
    expect(body['areaCell']).toEqual({ latitude: 13.73, longitude: 100.54 })
  })

  it('201 for whole-number coordinates, whose cell is the point itself', async () => {
    // JSON has no integer type, but a client may still send 14 rather than 14.0.
    const response = await put(NOK, { ...minimal, area: { latitude: 14, longitude: 100 } })
    const body = (await response.clone().json()) as Record<string, unknown>
    await expectContract('createProfile', 201, response)

    expect(body['area']).toEqual({ latitude: 14, longitude: 100 })
    expect(body['areaCell']).toEqual({ latitude: 14, longitude: 100 })
  })

  it('400 when the area is missing — it is required', async () => {
    await expectContract('createProfile', 400, await put(NOK, { displayName: 'Nok', birthYear: 1994 }))
  })

  it('400 when a coordinate is a string, not a number', async () => {
    const area = { latitude: '13.7314', longitude: 100.5414 }
    await expectContract('createProfile', 400, await put(NOK, { ...minimal, area }))
  })

  it('400 when the area carries a key the contract does not', async () => {
    const area = { ...minimal.area, altitude: 2 }
    await expectContract('createProfile', 400, await put(NOK, { ...minimal, area }))
  })

  it('400 when the body tries to write the cell — it is derived', async () => {
    await expectContract('createProfile', 400, await put(NOK, { ...minimal, areaCell: minimalCell }))
  })

  it('422 when a coordinate is off the map', async () => {
    const area = { latitude: 91, longitude: 100.5414 }
    await expectContract('createProfile', 422, await put(NOK, { ...minimal, area }))
  })

  it('400 when the body has an unknown field', async () => {
    await expectContract('createProfile', 400, await put(NOK, { ...minimal, nickname: 'Nok' }))
  })

  it('400 when the body is not valid JSON', async () => {
    const token = await identity.tokenFor(NOK)
    const response = await app.request(`/v1/profiles/${NOK}`, {
      method: 'PUT',
      body: '{ not json',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    })
    await expectContract('createProfile', 400, response)
  })

  it('401 without a token', async () => {
    const response = await app.request(`/v1/profiles/${NOK}`, {
      method: 'PUT',
      body: JSON.stringify(minimal),
      headers: { 'content-type': 'application/json' },
    })
    await expectContract('createProfile', 401, response)
  })

  it('401 when the token was signed by someone other than Identity', async () => {
    const token = await identity.tokenSignedByAnother(NOK)
    const response = await app.request(`/v1/profiles/${NOK}`, {
      method: 'PUT',
      body: JSON.stringify(minimal),
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    })
    await expectContract('createProfile', 401, response)
  })

  it('403 when creating someone else’s profile', async () => {
    await expectContract('createProfile', 403, await put(NOK, minimal, BEAM))
  })

  it('409 when the runner already has one', async () => {
    await givenAProfile()
    await expectContract('createProfile', 409, await put(NOK, minimal))
  })

  it('422 when a value breaks a §4 rule', async () => {
    await expectContract('createProfile', 422, await put(NOK, { ...minimal, birthYear: 1899 }))
  })

  it('422 for a value outside a closed union', async () => {
    await expectContract('createProfile', 422, await put(NOK, { ...minimal, gender: 'banana' }))
  })
})

describe('GET /v1/profiles/{userId} — getProfile', () => {
  it('200 returns the profile', async () => {
    await givenAProfile()
    await expectContract('getProfile', 200, await as(NOK, `/v1/profiles/${NOK}`))
  })

  it('200 for any authenticated caller — reading is not owner-only', async () => {
    await givenAProfile()
    await expectContract('getProfile', 200, await as(BEAM, `/v1/profiles/${NOK}`))
  })

  it('200 shows the owner the exact area and its cell', async () => {
    await givenAProfile()
    const response = await as(NOK, `/v1/profiles/${NOK}`)
    const body = (await response.clone().json()) as Record<string, unknown>
    await expectContract('getProfile', 200, response)

    expect(body['area']).toEqual(minimal.area)
    expect(body['areaCell']).toEqual(minimalCell)
  })

  it('200 shows another runner the cell and never the exact area — NFR-4.1', async () => {
    await givenAProfile()
    const response = await as(BEAM, `/v1/profiles/${NOK}`)
    const body = (await response.clone().json()) as Record<string, unknown>
    await expectContract('getProfile', 200, response)

    expect('area' in body).toBe(false)
    expect(body['areaCell']).toEqual(minimalCell)
    // Not just the key: the exact coordinates appear nowhere in what another runner receives.
    expect(JSON.stringify(body)).not.toContain('13.7314')
    expect(JSON.stringify(body)).not.toContain('100.5414')
  })

  it('401 without a token', async () => {
    await expectContract('getProfile', 401, await app.request(`/v1/profiles/${NOK}`))
  })

  it('404 when there is no such profile', async () => {
    await expectContract('getProfile', 404, await as(NOK, `/v1/profiles/${NOK}`))
  })
})

describe('PATCH /v1/profiles/{userId} — updateProfile', () => {
  // openapi.yaml declares the PATCH body under application/merge-patch+json and nothing else.
  const patch = (userId: string, body: unknown, as_ = userId): Promise<Response> =>
    as(as_, `/v1/profiles/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/merge-patch+json' },
    })

  it('200 changes a field', async () => {
    await givenAProfile(NOK, { ...minimal, bio: 'Chasing a sub-2 half.' })
    const response = await patch(NOK, { displayName: 'Nok R.' })
    const body = (await response.clone().json()) as Record<string, unknown>
    await expectContract('updateProfile', 200, response)

    expect(body['displayName']).toBe('Nok R.')
    expect(body['bio']).toBe('Chasing a sub-2 half.')
  })

  it('200 and null clears a field rather than emptying it', async () => {
    await givenAProfile(NOK, { ...minimal, bio: 'Chasing a sub-2 half.' })
    const response = await patch(NOK, { bio: null })
    const body = (await response.clone().json()) as Record<string, unknown>
    await expectContract('updateProfile', 200, response)

    expect('bio' in body).toBe(false)
  })

  it('200 moves the area, and the cell follows', async () => {
    await givenAProfile()
    const response = await patch(NOK, { area: { latitude: 13.803, longitude: 100.553 } })
    const body = (await response.clone().json()) as Record<string, unknown>
    await expectContract('updateProfile', 200, response)

    expect(body['area']).toEqual({ latitude: 13.803, longitude: 100.553 })
    expect(body['areaCell']).toEqual({ latitude: 13.8, longitude: 100.55 })
  })

  it('another runner sees the moved cell, and still not the area', async () => {
    await givenAProfile()
    await patch(NOK, { area: { latitude: 13.803, longitude: 100.553 } })
    const response = await as(BEAM, `/v1/profiles/${NOK}`)
    const body = (await response.clone().json()) as Record<string, unknown>
    await expectContract('getProfile', 200, response)

    expect('area' in body).toBe(false)
    expect(body['areaCell']).toEqual({ latitude: 13.8, longitude: 100.55 })
  })

  it('400 when the area is sent as null — it cannot be cleared', async () => {
    await givenAProfile()
    await expectContract('updateProfile', 400, await patch(NOK, { area: null }))
  })

  it('400 when only half of the area is sent — it is replaced whole', async () => {
    await givenAProfile()
    await expectContract('updateProfile', 400, await patch(NOK, { area: { latitude: 13.8 } }))
  })

  it('400 when the body has an unknown field', async () => {
    await givenAProfile()
    await expectContract('updateProfile', 400, await patch(NOK, { nickname: 'Nok' }))
  })

  it('400 when a field that cannot be cleared is sent as null', async () => {
    await givenAProfile()
    await expectContract('updateProfile', 400, await patch(NOK, { displayName: null }))
  })

  it('401 without a token', async () => {
    await givenAProfile()
    const response = await app.request(`/v1/profiles/${NOK}`, {
      method: 'PATCH',
      body: JSON.stringify({ displayName: 'Nok R.' }),
      headers: { 'content-type': 'application/json' },
    })
    await expectContract('updateProfile', 401, response)
  })

  it('403 when changing someone else’s profile', async () => {
    await givenAProfile()
    await expectContract('updateProfile', 403, await patch(NOK, { displayName: 'Mine now' }, BEAM))
  })

  it('404 when there is no such profile', async () => {
    await expectContract('updateProfile', 404, await patch(BEAM, { displayName: 'Beam' }))
  })

  it('422 when a value breaks a §4 rule', async () => {
    await givenAProfile()
    await expectContract('updateProfile', 422, await patch(NOK, { pace: 10 }))
  })
})

describe('DELETE /v1/profiles/{userId} — deleteProfile', () => {
  const remove = (userId: string, as_ = userId): Promise<Response> =>
    as(as_, `/v1/profiles/${userId}`, { method: 'DELETE' })

  it('204 removes it, with no body', async () => {
    await givenAProfile()
    await expectContract('deleteProfile', 204, await remove(NOK))
    await expectContract('getProfile', 404, await as(NOK, `/v1/profiles/${NOK}`))
  })

  it('401 without a token', async () => {
    await expectContract(
      'deleteProfile',
      401,
      await app.request(`/v1/profiles/${NOK}`, { method: 'DELETE' }),
    )
  })

  it('403 when removing someone else’s profile', async () => {
    await givenAProfile()
    await expectContract('deleteProfile', 403, await remove(NOK, BEAM))
  })

  it('404 when there is nothing to remove', async () => {
    await expectContract('deleteProfile', 404, await remove(BEAM))
  })
})

describe('GET /health', () => {
  it('200 without a token — it is the one public endpoint', async () => {
    await expectContract('health', 200, await app.request('/health'))
  })

  it('answers while the database is unreachable, because it never asks', async () => {
    const isolated = createApp({
      useCases: {
        createProfile: () => Promise.reject(new Error('database is down')),
        getProfile: () => Promise.reject(new Error('database is down')),
        updateProfile: () => Promise.reject(new Error('database is down')),
        deleteProfile: () => Promise.reject(new Error('database is down')),
        createAvatarUpload: () => Promise.reject(new Error('database is down')),
      },
      logger: pino({ level: 'silent' }),
      authentication: { jwks: identity.jwks, issuer: identity.issuer, audience: identity.audience },
      readiness: alwaysReady,
    })
    await expectContract('health', 200, await isolated.request('/health'))
  })
})

describe('the request context', () => {
  it('is current while the request is served, so the event publisher can pass it on (NFR-7.4)', async () => {
    await put(NOK, minimal)
    const response = await as(NOK, `/v1/profiles/${NOK}`, {
      method: 'PATCH',
      body: JSON.stringify({ displayName: 'Nok R.' }),
      headers: { 'content-type': 'application/merge-patch+json', 'x-request-id': 'abc123' },
    })
    expect(response.status).toBe(200)
    expect(requestIdWhenPublished).toBe('abc123')
  })

  it('is gone once the request is over', () => {
    expect(currentRequestId()).toBeUndefined()
  })

  it('echoes a correlation id back', async () => {
    const response = await app.request('/health')
    expect(response.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('mints one when the X-Request-Id it is given is empty — an empty id joins nothing', async () => {
    const response = await app.request('/health', { headers: { 'x-request-id': '' } })
    expect(response.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('carries a given X-Request-Id through', async () => {
    const response = await app.request('/health', { headers: { 'x-request-id': 'abc123' } })
    expect(response.headers.get('x-request-id')).toBe('abc123')
  })

  it('prefers the trace id from traceparent', async () => {
    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736'
    const response = await app.request('/health', {
      headers: { traceparent: `00-${traceId}-00f067aa0ba902b7-01` },
    })
    expect(response.headers.get('x-request-id')).toBe(traceId)
  })
})

describe('an unexpected failure', () => {
  const brokenApp = (): ReturnType<typeof createApp> => {
    const onFire = (): Promise<never> => Promise.reject(new Error('the pool is on fire'))
    return createApp({
      useCases: {
        createProfile: onFire,
        getProfile: onFire,
        updateProfile: onFire,
        deleteProfile: onFire,
        createAvatarUpload: onFire,
      },
      logger: pino({ level: 'silent' }),
      authentication: { jwks: identity.jwks, issuer: identity.issuer, audience: identity.audience },
      readiness: alwaysReady,
    })
  }

  it.each([
    ['getProfile', 'GET', undefined],
    ['createProfile', 'PUT', JSON.stringify(minimal)],
    ['updateProfile', 'PATCH', JSON.stringify({ displayName: 'Nok R.' })],
    ['deleteProfile', 'DELETE', undefined],
    ['createAvatarUpload', 'POST', undefined],
  ] as const)('%s becomes a 500 matching the default response', async (operationId, method, body) => {
    const token = await identity.tokenFor(NOK)
    const path = operationId === 'createAvatarUpload' ? `/v1/profiles/${NOK}/avatar-uploads` : `/v1/profiles/${NOK}`
    const response = await brokenApp().request(path, {
      method,
      ...(body !== undefined && { body }),
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    })
    const payload = (await response.clone().json()) as Record<string, unknown>

    await expectContract(operationId, 500, response)
    // A 500 deliberately says nothing useful — no detail, and never the cause.
    expect(payload['detail']).toBeUndefined()
    expect(JSON.stringify(payload)).not.toContain('pool is on fire')
  })
})

describe('the edges of authentication', () => {
  it('accepts a lowercase scheme — RFC 9110 makes it case-insensitive', async () => {
    await givenAProfile()
    const token = await identity.tokenFor(NOK)
    const response = await app.request(`/v1/profiles/${NOK}`, {
      headers: { authorization: `bearer ${token}` },
    })
    await expectContract('getProfile', 200, response)
  })

  it('refuses a token with no expiry, however well signed', async () => {
    const token = await identity.tokenWithoutExpiry(NOK)
    const response = await app.request(`/v1/profiles/${NOK}`, {
      headers: { authorization: `Bearer ${token}` },
    })
    await expectContract('getProfile', 401, response)
  })
})

describe('sets are sets', () => {
  it('400 rather than silently deduplicating what the client sent', async () => {
    const response = await put(NOK, { ...minimal, preferredDistances: ['5k', '5k'] })
    await expectContract('createProfile', 400, response)
  })

  it('400 for a repeated day and time', async () => {
    const repeated = [
      { dayOfWeek: 'mon', timeOfDay: 'evening' },
      { dayOfWeek: 'mon', timeOfDay: 'evening' },
    ]
    await expectContract('createProfile', 400, await put(NOK, { ...minimal, preferredRunTimes: repeated }))
  })
})

describe('an unmatched path', () => {
  it('answers in problem+json like every other error', async () => {
    const response = await as(NOK, '/v1/profiles')
    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toContain('application/problem+json')
    expect(await response.json()).toEqual({ title: 'Not found', status: 404 })
  })
})

describe('a SyntaxError from below the route', () => {
  it('is a 500, not a malformed body — the request had no body at all', async () => {
    const parsedBadJson = createApp({
      useCases: {
        createProfile: () => Promise.reject(new SyntaxError('a driver parsed bad JSON')),
        getProfile: () => Promise.reject(new SyntaxError('a driver parsed bad JSON')),
        updateProfile: () => Promise.reject(new SyntaxError('a driver parsed bad JSON')),
        deleteProfile: () => Promise.reject(new SyntaxError('a driver parsed bad JSON')),
        createAvatarUpload: () => Promise.reject(new SyntaxError('a driver parsed bad JSON')),
      },
      logger: pino({ level: 'silent' }),
      authentication: { jwks: identity.jwks, issuer: identity.issuer, audience: identity.audience },
      readiness: alwaysReady,
    })
    const token = await identity.tokenFor(NOK)
    const response = await parsedBadJson.request(`/v1/profiles/${NOK}`, {
      headers: { authorization: `Bearer ${token}` },
    })
    await expectContract('getProfile', 500, response)
  })

  it('still answers 400 when the body really is not JSON', async () => {
    const token = await identity.tokenFor(NOK)
    const response = await app.request(`/v1/profiles/${NOK}`, {
      method: 'PUT',
      body: '{ not json',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    })
    await expectContract('createProfile', 400, response)
  })
})

describe('a userId outside the bounds the contract declares', () => {
  const tooLong = 'x'.repeat(100)

  it('matches no profile on read — 404, not a special rejection', async () => {
    await expectContract('getProfile', 404, await as(tooLong, `/v1/profiles/${tooLong}`))
  })

  it('fails §4 on create, like any other bad field — 422', async () => {
    await expectContract('createProfile', 422, await put(tooLong, minimal))
  })
})

describe('GET /ready', () => {
  const withReadiness = (readiness: {
    isDraining: () => boolean
    canServe: () => Promise<boolean>
  }): ReturnType<typeof createApp> =>
    createApp({
      useCases: {
        createProfile: () => Promise.reject(new Error('unused')),
        getProfile: () => Promise.reject(new Error('unused')),
        updateProfile: () => Promise.reject(new Error('unused')),
        deleteProfile: () => Promise.reject(new Error('unused')),
        createAvatarUpload: () => Promise.reject(new Error('unused')),
      },
      logger: pino({ level: 'silent' }),
      authentication: { jwks: identity.jwks, issuer: identity.issuer, audience: identity.audience },
      readiness,
    })

  it('200 when serving — and no token needed, like /health', async () => {
    await expectContract('readiness', 200, await app.request('/ready'))
  })

  it('503 while draining, so traffic is routed elsewhere rather than the process restarted', async () => {
    const response = await withReadiness({ isDraining: () => true, canServe: () => Promise.resolve(true) }).request('/ready')
    const body = await response.clone().json()
    await expectContract('readiness', 503, response)
    expect(body).toEqual({ status: 'draining' })
  })

  it('503 rather than 500 when the probe itself throws', async () => {
    // openapi.yaml documents 200 and 503 for this operation and no default, so the route has
    // to hold that line whatever probe it is given.
    const throwing = {
      isDraining: () => false,
      canServe: () => Promise.reject(new Error('the pool exploded')),
    }
    const response = await withReadiness(throwing).request('/ready')
    const body = await response.clone().json()
    await expectContract('readiness', 503, response)
    expect(body).toEqual({ status: 'unavailable' })
  })

  it('503 when the database is out of reach — unlike /health, which does not ask', async () => {
    const unreachable = { isDraining: () => false, canServe: () => Promise.resolve(false) }
    const response = await withReadiness(unreachable).request('/ready')
    const body = await response.clone().json()
    await expectContract('readiness', 503, response)
    expect(body).toEqual({ status: 'unavailable' })

    // The same instance still reports itself alive: a drained or database-less process is not
    // a wedged one, and restarting it would fix nothing.
    await expectContract('health', 200, await withReadiness(unreachable).request('/health'))
  })
})

describe('POST /v1/profiles/{userId}/avatar-uploads — createAvatarUpload', () => {
  const ask = (userId: string, as_ = userId): Promise<Response> =>
    as(as_, `/v1/profiles/${userId}/avatar-uploads`, { method: 'POST' })

  it('201 hands back somewhere to upload and the key it will occupy', async () => {
    await givenAProfile()
    const response = await ask(NOK)
    const body = (await response.clone().json()) as Record<string, unknown>
    await expectContract('createAvatarUpload', 201, response)

    expect(body['avatarRef']).toBe(`avatars/${NOK}/abc`)
    expect(String(body['uploadUrl'])).toContain('X-Amz-Signature')
  })

  it('201 and the profile is untouched — avatarRef is updateProfile\u2019s to set', async () => {
    await givenAProfile()
    await ask(NOK)

    const profile = (await (await as(NOK, `/v1/profiles/${NOK}`)).json()) as Record<string, unknown>
    expect('avatarRef' in profile).toBe(false)
  })

  it('401 without a token', async () => {
    await givenAProfile()
    await expectContract(
      'createAvatarUpload',
      401,
      await app.request(`/v1/profiles/${NOK}/avatar-uploads`, { method: 'POST' }),
    )
  })

  it('403 when uploading to someone else\u2019s profile', async () => {
    await givenAProfile()
    await expectContract('createAvatarUpload', 403, await ask(NOK, BEAM))
  })

  it('404 when there is no profile to attach one to', async () => {
    await expectContract('createAvatarUpload', 404, await ask(BEAM))
  })
})

describe('the documentation', () => {
  it('renders the contract without a token', async () => {
    await expectContract('documentation', 200, await app.request('/docs'))
  })

  it('hands over the document itself without a token', async () => {
    await expectContract('contract', 200, await app.request('/openapi.yaml'))
  })

  it('answers a problem when the contract is missing from the image', async () => {
    // The Dockerfile has to COPY docs/openapi.yaml; nothing else proves what happens if it
    // does not. Handing the handler a path that is not there is the only reachable version
    // of that failure, and openapi.yaml documents a default for exactly this.
    const missing = new Hono<Env>()
    missing.onError(errorHandler(pino({ level: 'silent' })))
    missing.get('/openapi.yaml', contractDocument('/no/such/openapi.yaml'))
    await expectContract('contract', 500, await missing.request('/openapi.yaml'))
  })

  it('serves the document this service was actually built from', async () => {
    const served = await (await app.request('/openapi.yaml')).text()
    expect(served).toBe(readFileSync('docs/openapi.yaml', 'utf8'))
  })

  it('serves Swagger UI from the image, so the page needs no network', async () => {
    const script = await app.request('/docs/swagger-ui-bundle.js')
    expect(script.status).toBe(200)
    expect(script.headers.get('content-type')).toContain('javascript')
    expect((await script.text()).length).toBeGreaterThan(100_000)
  })

  it('names no CDN in the page it serves', async () => {
    expect(await (await app.request('/docs')).text()).not.toMatch(/https?:\/\//)
  })

  it('refuses to serve anything but the assets it allows', async () => {
    for (const path of ['/docs/package.json', '/docs/..%2F..%2Fpackage.json', '/docs/index.html']) {
      expect((await app.request(path)).status, path).toBe(404)
    }
  })
})

describe('the contract itself', () => {
  it('has every documented response exercised by at least one test', () => {
    expect([...exercised].sort()).toEqual([...documentedResponses].sort())
  })
})

describe('profile events — the use cases tell subscribers', () => {
  const patch = (userId: string, body: unknown): Promise<Response> =>
    as(userId, `/v1/profiles/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/merge-patch+json' },
    })

  it('PUT publishes ProfileUpdated with the saved profile', async () => {
    await expectContract('createProfile', 201, await put(NOK, minimal))
    expect(events.published.map((e) => e.type)).toEqual(['updated'])
  })

  it('PATCH publishes the profile as saved', async () => {
    await givenAProfile()
    await expectContract('updateProfile', 200, await patch(NOK, { displayName: 'Nok R.' }))
    const last = events.published.at(-1)
    expect(last?.type === 'updated' && last.profile.displayName).toBe('Nok R.')
  })

  it('DELETE publishes ProfileDeleted', async () => {
    await givenAProfile()
    await expectContract('deleteProfile', 204, await as(NOK, `/v1/profiles/${NOK}`, { method: 'DELETE' }))
    expect(events.published.at(-1)).toEqual({ type: 'deleted', userId: NOK })
  })

  it('a refused write publishes nothing', async () => {
    await givenAProfile()
    events.published.length = 0
    await expectContract('createProfile', 409, await put(NOK, minimal))
    await expectContract('updateProfile', 422, await patch(NOK, { pace: 10 }))
    expect(events.published).toEqual([])
  })

  it('still answers 201, 200 and 204 when Buddy Discovery is down (ADR-0019)', async () => {
    events.failWith = new Error('Buddy Discovery is down')
    await expectContract('createProfile', 201, await put(NOK, minimal))
    await expectContract('updateProfile', 200, await patch(NOK, { displayName: 'Nok R.' }))
    await expectContract('deleteProfile', 204, await as(NOK, `/v1/profiles/${NOK}`, { method: 'DELETE' }))
    expect(undelivered).toEqual([NOK, NOK, NOK])
  })
})
