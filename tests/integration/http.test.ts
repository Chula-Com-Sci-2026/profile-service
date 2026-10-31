import { readFileSync } from 'node:fs'
import { sql } from 'drizzle-orm'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Hono } from 'hono'
import pg from 'pg'
import { type Logger, pino } from 'pino'
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest'
import { attachPhoto } from '../../src/application/attach-photo.ts'
import { createPhotoUpload } from '../../src/application/create-photo-upload.ts'
import { getProfile } from '../../src/application/get-profile.ts'
import { getPublicProfile } from '../../src/application/get-public-profile.ts'
import type { PhotoStorage } from '../../src/application/ports/photo-storage.ts'
import { removePhoto } from '../../src/application/remove-photo.ts'
import { saveProfile } from '../../src/application/save-profile.ts'
import { setFieldVisibility } from '../../src/application/set-field-visibility.ts'
import { DrizzleProfileRepository } from '../../src/infrastructure/drizzle-profile-repository.ts'
import { createApp, type UseCases } from '../../src/interface/http/app.ts'
import type { Env } from '../../src/interface/http/context.ts'
import { contractDocument } from '../../src/interface/http/docs.ts'
import { errorHandler } from '../../src/interface/http/error-handler.ts'
import { currentCorrelationId } from '../../src/interface/http/request-context.ts'
import { documentedResponses, exercised, expectContract, expectSchema } from './contract.ts'
import { FakePhotoStorage, keyFor } from '../unit/application/photo-storage-double.ts'
import { RecordingProfileEvents } from '../unit/application/profile-events-double.ts'
import { anIdentity, type Identity } from './identity.ts'

const alwaysReady = { isDraining: () => false, canServe: () => Promise.resolve(true) }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const NOK = '33333333-3333-4333-8333-333333333333'
const BEAM = '44444444-4444-4444-8444-444444444444'
const ME = '/api/v1/me/profile'
const runner = (id: string): string => `/api/v1/runners/${id}`

/** Path style, as photoUrlFor builds it from the public endpoint and the bucket. */
const photoUrl = (photoRef: string): string => `http://localhost:9000/profile-service/${photoRef}`

let pool: pg.Pool
let db: NodePgDatabase
let app: Hono<Env>
let identity: Identity
/** What the app published during the current test; reset before each. */
let events: RecordingProfileEvents
const undelivered: string[] = []
let correlationIdWhenPublished: string | undefined
/** Object storage for the current test; reset before each. */
let storage: FakePhotoStorage
const orphaned: string[] = []

/** Reads `storage` at call time, so each test sees a fresh one. */
const currentStorage: PhotoStorage = {
  createUpload: (id) => storage.createUpload(id),
  holds: (id, photoRef) => storage.holds(id, photoRef),
  remove: (id, photoRef) => storage.remove(id, photoRef),
}
const onOrphan = (id: string): void => {
  orphaned.push(id)
}

/** Reads `events` at call time, so each test sees a fresh recorder. */
const publishing = () => ({
  events: {
    updated: (profile: Parameters<RecordingProfileEvents['updated']>[0]) => {
      correlationIdWhenPublished = currentCorrelationId()
      return events.updated(profile)
    },
  },
  onUndelivered: (id: string) => {
    undelivered.push(id)
  },
})

/** Every use case answering the same way — for an app whose use cases a test does not care about. */
function everyUseCase(answer: () => Promise<never>): UseCases {
  return {
    saveProfile: answer,
    getProfile: answer,
    getPublicProfile: answer,
    setFieldVisibility: answer,
    createPhotoUpload: answer,
    attachPhoto: answer,
    removePhoto: answer,
  }
}

type AppExtras = { logger?: Logger; readiness?: typeof alwaysReady }

const appWith = (useCases: UseCases, extras: AppExtras = {}): Hono<Env> =>
  createApp({
    useCases,
    logger: extras.logger ?? pino({ level: 'silent' }),
    authentication: identity.settings,
    readiness: extras.readiness ?? alwaysReady,
    photoUrl,
  })

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: inject('databaseUrl') })
  db = drizzle(pool)
  identity = anIdentity()
  const repository = new DrizzleProfileRepository(db)
  events = new RecordingProfileEvents()

  app = createApp({
    useCases: {
      saveProfile: saveProfile(repository, publishing()),
      getProfile: getProfile(repository),
      getPublicProfile: getPublicProfile(repository),
      setFieldVisibility: setFieldVisibility(repository, publishing()),
      createPhotoUpload: createPhotoUpload(repository, currentStorage),
      attachPhoto: attachPhoto(repository, currentStorage, onOrphan, publishing()),
      removePhoto: removePhoto(repository, currentStorage, onOrphan, publishing()),
    },
    logger: pino({ level: 'silent' }),
    authentication: identity.settings,
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
    photoUrl,
  })
})

afterAll(async () => {
  await pool.end()
})

beforeEach(async () => {
  await db.execute(sql`TRUNCATE profiles`)
  events = new RecordingProfileEvents()
  undelivered.length = 0
  correlationIdWhenPublished = undefined
  storage = new FakePhotoStorage()
  orphaned.length = 0
})

/** His contract's required fields, and nothing else. */
const minimal = {
  name: 'Nok',
  paceMin: 7,
  paceMax: 8,
  experience: 'Beginner',
  area: 'Lumphini Park',
  latitude: 13.7314,
  longitude: 100.5414,
  availability: 'Sat early mornings',
}
/** `minimal`'s point, as its cell. */
const minimalCell = { latitude: 13.73, longitude: 100.54 }

async function as(id: string, path: string, init: RequestInit = {}): Promise<Response> {
  const token = await identity.tokenFor(id)
  return app.request(path, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...init.headers },
  })
}

const save = (id: string, body: unknown): Promise<Response> => as(id, ME, { method: 'PUT', body: JSON.stringify(body) })

async function givenAProfile(id = NOK, body: unknown = minimal): Promise<void> {
  const response = await save(id, body)
  expect(response.status).toBe(200)
}

const bodyOf = async (response: Response): Promise<Record<string, unknown>> =>
  (await response.clone().json()) as Record<string, unknown>

describe('PUT /api/v1/me/profile — saveProfile', () => {
  it('200 creates the profile on the first save, answering the owner’s view with every key', async () => {
    const response = await save(NOK, minimal)
    const body = await bodyOf(response)
    await expectContract('saveProfile', 200, response)

    expectSchema('Profile', body)
    expect(body).toMatchObject({ id: NOK, ...minimal, areaCell: minimalCell, hiddenFields: [] })
    for (const key of ['bio', 'usualDistance', 'gear', 'photoRef', 'photoUrl']) expect(body[key]).toBeNull()
  })

  it('200 again on a later save, which replaces it — a bio left out is no bio', async () => {
    await givenAProfile(NOK, { ...minimal, bio: 'Chasing a sub-2 half.' })
    const response = await save(NOK, { ...minimal, name: 'Nok R.', area: 'Benjakitti Park' })
    const body = await bodyOf(response)
    await expectContract('saveProfile', 200, response)

    expect(body).toMatchObject({ name: 'Nok R.', area: 'Benjakitti Park', bio: null })
  })

  it('200 keeps usualDistance and gear when left out, and clears them with null', async () => {
    await givenAProfile(NOK, { ...minimal, usualDistance: '5–10 km', gear: ['Pegasus 41'] })

    const kept = await bodyOf(await save(NOK, minimal))
    expect(kept).toMatchObject({ usualDistance: '5–10 km', gear: ['Pegasus 41'] })

    const response = await save(NOK, { ...minimal, usualDistance: null, gear: null })
    const body = await bodyOf(response)
    await expectContract('saveProfile', 200, response)
    expect(body).toMatchObject({ usualDistance: null, gear: null })
  })

  it('200 clears gear with [] too, and answers null rather than []', async () => {
    await givenAProfile(NOK, { ...minimal, gear: ['Pegasus 41'] })
    const response = await save(NOK, { ...minimal, gear: [] })
    const body = await bodyOf(response)
    await expectContract('saveProfile', 200, response)
    expect(body['gear']).toBeNull()
  })

  it('200 answers the owner with the exact point and its cell', async () => {
    const response = await save(NOK, { ...minimal, latitude: 13.73172, longitude: 100.54153 })
    const body = await bodyOf(response)
    await expectContract('saveProfile', 200, response)

    expect(body).toMatchObject({ latitude: 13.73172, longitude: 100.54153, areaCell: { latitude: 13.73, longitude: 100.54 } })
  })

  it('200 keeps the pace to the nearest second', async () => {
    const response = await save(NOK, { ...minimal, paceMin: 6.3333, paceMax: 6.5 })
    const body = await bodyOf(response)
    await expectContract('saveProfile', 200, response)
    expect(body['paceMin']).toBe(6.333333333333333)
  })

  it('200 for two paces in the same second, sent the wrong way round — equal once kept to the second', async () => {
    const response = await save(NOK, { ...minimal, paceMin: 6.334, paceMax: 6.333 })
    const body = await bodyOf(response)
    await expectContract('saveProfile', 200, response)
    expect(body).toMatchObject({ paceMin: 6.333333333333333, paceMax: 6.333333333333333 })
  })

  it('200 ignores fields a save cannot write, and fields it does not know', async () => {
    const response = await save(NOK, {
      ...minimal,
      id: BEAM,
      areaCell: { latitude: 0, longitude: 0 },
      hiddenFields: ['bio'],
      photoRef: `photos/${NOK}/abc`,
      photoUrl: 'http://elsewhere.test/x.png',
      nickname: 'N',
    })
    const body = await bodyOf(response)
    await expectContract('saveProfile', 200, response)

    expect(body).toMatchObject({ id: NOK, areaCell: minimalCell, hiddenFields: [], photoRef: null, photoUrl: null })
    expect('nickname' in body).toBe(false)
    expect((await as(BEAM, ME)).status).toBe(404) // the body's id wrote nothing for BEAM
  })

  it.each(['name', 'paceMin', 'paceMax', 'experience', 'area', 'latitude', 'longitude', 'availability'])(
    '422 when %s is missing — it is required',
    async (field) => {
      const body: Record<string, unknown> = { ...minimal }
      delete body[field]
      const response = await save(NOK, body)
      const answer = (await bodyOf(response)) as { fieldErrors?: Record<string, string> }
      await expectContract('saveProfile', 422, response)
      expect(Object.keys(answer.fieldErrors ?? {})).toEqual([field])
    },
  )

  it.each([
    ['experience in lowercase', { experience: 'beginner' }, 'experience'],
    ['a pace that rounds to 0 seconds', { paceMin: 0.004 }, 'paceMin'],
    ['a paceMin slower than paceMax', { paceMin: 9, paceMax: 8 }, 'paceMin'],
    ['a paceMax over 20', { paceMax: 20.5 }, 'paceMax'],
    ['a name of 81 characters', { name: 'x'.repeat(81) }, 'name'],
    ['a bio of 241 characters', { bio: 'x'.repeat(241) }, 'bio'],
    ['an area of 101 characters', { area: 'x'.repeat(101) }, 'area'],
    ['availability of 121 characters', { availability: 'x'.repeat(121) }, 'availability'],
    ['a latitude off the map', { latitude: 91 }, 'latitude'],
    ['eleven gear items', { gear: Array.from({ length: 11 }, (_, i) => `item ${i}`) }, 'gear'],
    ['a gear item repeated exactly', { gear: ['Pegasus 41', 'Pegasus 41'] }, 'gear'],
    ['a gear item that is blank once trimmed', { gear: ['   '] }, 'gear'],
  ] as const)('422 for %s, naming %s', async (_, change, field) => {
    const response = await save(NOK, { ...minimal, ...change })
    const body = await bodyOf(response)
    await expectContract('saveProfile', 422, response)
    expect(body).toMatchObject({ code: 'validation_failed', fieldErrors: { [field]: expect.any(String) } })
  })

  it('422 for "5-10 km" with a hyphen, naming the three bands so the en dash can be put right', async () => {
    const response = await save(NOK, { ...minimal, usualDistance: '5-10 km' })
    const body = (await bodyOf(response)) as { fieldErrors?: Record<string, string> }
    await expectContract('saveProfile', 422, response)
    expect(body.fieldErrors?.['usualDistance']).toContain('Under 5 km, 5–10 km, Over 10 km')
  })

  it.each([
    ['not JSON', '{ not json'],
    ['JSON null', 'null'],
    ['a JSON array', '[]'],
  ])('422 naming no field when the body is %s', async (_, raw) => {
    const token = await identity.tokenFor(NOK)
    const response = await app.request(ME, {
      method: 'PUT',
      body: raw,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    })
    const body = await bodyOf(response)
    await expectContract('saveProfile', 422, response)
    expect('fieldErrors' in body).toBe(false)
  })

  it('422 names every malformed field at once, each by its top-level name', async () => {
    const response = await save(NOK, { ...minimal, name: 5, latitude: '13.7', gear: ['a', 'a'] })
    const body = (await bodyOf(response)) as { fieldErrors?: Record<string, string> }
    await expectContract('saveProfile', 422, response)
    expect(Object.keys(body.fieldErrors ?? {}).sort()).toEqual(['gear', 'latitude', 'name'])
  })

  it('401 without a token', async () => {
    const response = await app.request(ME, {
      method: 'PUT',
      body: JSON.stringify(minimal),
      headers: { 'content-type': 'application/json' },
    })
    await expectContract('saveProfile', 401, response)
  })

  it('401 when the token was signed by someone other than Identity', async () => {
    const token = await identity.tokenWith(NOK, { secret: 'not-identitys-secret' })
    const response = await app.request(ME, {
      method: 'PUT',
      body: JSON.stringify(minimal),
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    })
    await expectContract('saveProfile', 401, response)
  })

  it('an error body carries the request’s correlation id', async () => {
    const id = 'abcdef01-2345-4678-89ab-cdef01234567'
    const response = await app.request(ME, { headers: { 'x-correlation-id': id } })
    const body = await bodyOf(response)
    await expectContract('getProfile', 401, response)
    expect(body).toMatchObject({ code: 'unauthorized', correlationId: id })
  })
})

describe('GET /api/v1/me/profile — getProfile', () => {
  it('200 returns the caller’s whole profile', async () => {
    await givenAProfile()
    const response = await as(NOK, ME)
    const body = await bodyOf(response)
    await expectContract('getProfile', 200, response)

    expectSchema('Profile', body)
    expect(body).toMatchObject({ id: NOK, latitude: minimal.latitude, longitude: minimal.longitude, areaCell: minimalCell })
  })

  it('404 before the first save', async () => {
    const response = await as(NOK, ME)
    const body = await bodyOf(response)
    await expectContract('getProfile', 404, response)
    expect(body['code']).toBe('profile_not_found')
  })

  it('401 without a token', async () => {
    await expectContract('getProfile', 401, await app.request(ME))
  })
})

describe('GET /api/v1/runners/{id} — getPublicProfile', () => {
  it('200 shows another runner the card — the cell, and never the exact point (NFR-4.1)', async () => {
    await givenAProfile()
    const response = await as(BEAM, runner(NOK))
    const body = await bodyOf(response)
    await expectContract('getPublicProfile', 200, response)

    expectSchema('PublicCard', body)
    expect(body).toMatchObject({ id: NOK, name: 'Nok', area: 'Lumphini Park', areaCell: minimalCell, photoUrl: null })
    expect('latitude' in body).toBe(false)
    expect(JSON.stringify(body)).not.toContain('13.7314')
    expect(JSON.stringify(body)).not.toContain('100.5414')
  })

  it('200 shows its owner the same card, not the whole profile', async () => {
    await givenAProfile()
    const response = await as(NOK, runner(NOK))
    const body = await bodyOf(response)
    await expectContract('getPublicProfile', 200, response)

    expectSchema('PublicCard', body)
    expect('latitude' in body).toBe(false)
    expect('hiddenFields' in body).toBe(false)
  })

  it('200 for the id in uppercase — ids are compared in lowercase', async () => {
    // The seed's ids are all digits, which have no case; this one has hex letters.
    const lettered = 'abcdef01-2345-4678-89ab-cdef01234567'
    await givenAProfile(lettered)
    const response = await as(BEAM, runner(lettered.toUpperCase()))
    const body = await bodyOf(response)
    await expectContract('getPublicProfile', 200, response)
    expect(body['id']).toBe(lettered)
  })

  it.each([['not-a-uuid'], ['x'.repeat(100)]])('404, not a 500, for %j — it is not an id, so it matches nobody', async (id) => {
    await givenAProfile()
    const response = await as(BEAM, runner(id))
    const body = await bodyOf(response)
    await expectContract('getPublicProfile', 404, response)
    expect(body['code']).toBe('profile_not_found')
  })

  it('404 for a runner with no profile', async () => {
    await expectContract('getPublicProfile', 404, await as(BEAM, runner(NOK)))
  })

  it('401 without a token', async () => {
    await expectContract('getPublicProfile', 401, await app.request(runner(NOK)))
  })
})

describe('PUT /api/v1/me/profile/visibility — setFieldVisibility', () => {
  const hide = (id: string, body: unknown): Promise<Response> =>
    as(id, `${ME}/visibility`, { method: 'PUT', body: JSON.stringify(body) })
  const full = { ...minimal, bio: 'Chasing a sub-2 half.', usualDistance: '5–10 km', gear: ['Pegasus 41'] }

  it('200 replaces the hidden set, and the owner still sees every field', async () => {
    await givenAProfile(NOK, full)
    const response = await hide(NOK, { hiddenFields: ['gear', 'bio', 'pace'] })
    const body = await bodyOf(response)
    await expectContract('setFieldVisibility', 200, response)

    expectSchema('Profile', body)
    expect(body).toMatchObject({ hiddenFields: ['bio', 'pace', 'gear'], bio: full.bio, paceMin: 7, gear: ['Pegasus 41'] })
  })

  it('makes a hidden field null on the card — to another runner and to its owner alike', async () => {
    await givenAProfile(NOK, full)
    await hide(NOK, { hiddenFields: ['bio', 'pace', 'gear'] })

    for (const reader of [BEAM, NOK]) {
      const response = await as(reader, runner(NOK))
      const body = await bodyOf(response)
      await expectContract('getPublicProfile', 200, response)
      expect(body).toMatchObject({ bio: null, paceMin: null, paceMax: null, gear: null })
      expect(body).toMatchObject({ name: 'Nok', area: 'Lumphini Park', areaCell: minimalCell, usualDistance: '5–10 km' })
    }
  })

  it('200 with [] reveals everything again', async () => {
    await givenAProfile(NOK, full)
    await hide(NOK, { hiddenFields: ['bio'] })
    const response = await hide(NOK, { hiddenFields: [] })
    await expectContract('setFieldVisibility', 200, response)
    expect((await bodyOf(await as(BEAM, runner(NOK))))['bio']).toBe(full.bio)
  })

  it('keeps the set through a later save — a save never un-hides', async () => {
    await givenAProfile(NOK, full)
    await hide(NOK, { hiddenFields: ['bio'] })
    const saved = await bodyOf(await save(NOK, { ...full, name: 'Nok R.' }))

    expect(saved['hiddenFields']).toEqual(['bio'])
    expect((await bodyOf(await as(BEAM, runner(NOK))))['bio']).toBeNull()
  })

  it('422 when a name repeats', async () => {
    await givenAProfile()
    const response = await hide(NOK, { hiddenFields: ['bio', 'bio'] })
    const body = await bodyOf(response)
    await expectContract('setFieldVisibility', 422, response)
    expect(body).toMatchObject({ fieldErrors: { hiddenFields: expect.any(String) } })
  })

  it('422 for a field that is always shown', async () => {
    await givenAProfile()
    const response = await hide(NOK, { hiddenFields: ['name'] })
    const body = await bodyOf(response)
    await expectContract('setFieldVisibility', 422, response)
    expect(body).toMatchObject({ fieldErrors: { hiddenFields: expect.any(String) } })
  })

  it('422 when the body has no hiddenFields', async () => {
    await givenAProfile()
    await expectContract('setFieldVisibility', 422, await hide(NOK, { hidden: ['bio'] }))
  })

  it('404 before the first save', async () => {
    await expectContract('setFieldVisibility', 404, await hide(NOK, { hiddenFields: ['bio'] }))
  })

  it('401 without a token', async () => {
    const response = await app.request(`${ME}/visibility`, {
      method: 'PUT',
      body: JSON.stringify({ hiddenFields: [] }),
      headers: { 'content-type': 'application/json' },
    })
    await expectContract('setFieldVisibility', 401, response)
  })

  it('publishes ProfileUpdated with the new set', async () => {
    await givenAProfile()
    events.published.length = 0
    await hide(NOK, { hiddenFields: ['gear'] })
    expect(events.published.at(-1)?.profile.hiddenFields).toEqual(['gear'])
  })
})

describe('POST /api/v1/me/profile/photo-uploads — createPhotoUpload', () => {
  const ask = (id: string): Promise<Response> => as(id, `${ME}/photo-uploads`, { method: 'POST' })

  it('201 hands back somewhere to upload and the key it will occupy', async () => {
    await givenAProfile()
    const response = await ask(NOK)
    const body = await bodyOf(response)
    await expectContract('createPhotoUpload', 201, response)

    expect(body).toMatchObject({ photoRef: keyFor(NOK), expiresInSeconds: 300 })
    expect(String(body['uploadUrl'])).toContain('X-Amz-Signature')
  })

  it('201 and the profile is untouched — attaching is attachPhoto’s job', async () => {
    await givenAProfile()
    await ask(NOK)
    expect((await bodyOf(await as(NOK, ME)))['photoRef']).toBeNull()
  })

  it('503 storage_unavailable when object storage does not answer', async () => {
    await givenAProfile()
    storage.unreachable = true
    const response = await ask(NOK)
    const body = await bodyOf(response)
    await expectContract('createPhotoUpload', 503, response)
    expect(body['code']).toBe('storage_unavailable')
  })

  it('404 before the first save', async () => {
    await expectContract('createPhotoUpload', 404, await ask(NOK))
  })

  it('401 without a token', async () => {
    await expectContract('createPhotoUpload', 401, await app.request(`${ME}/photo-uploads`, { method: 'POST' }))
  })
})

describe('PUT /api/v1/me/profile/photo — attachPhoto', () => {
  const attach = (id: string, body: unknown): Promise<Response> =>
    as(id, `${ME}/photo`, { method: 'PUT', body: JSON.stringify(body) })
  const uploaded = keyFor(NOK)

  it('200 puts the uploaded photo on the profile, with its public address', async () => {
    await givenAProfile()
    storage.objects.add(uploaded)
    const response = await attach(NOK, { photoRef: uploaded })
    const body = await bodyOf(response)
    await expectContract('attachPhoto', 200, response)

    expectSchema('Profile', body)
    expect(body).toMatchObject({ photoRef: uploaded, photoUrl: `http://localhost:9000/profile-service/${uploaded}` })
  })

  it('shows the photo on the card as its public address, to everyone', async () => {
    await givenAProfile()
    storage.objects.add(uploaded)
    await attach(NOK, { photoRef: uploaded })

    const card = await bodyOf(await as(BEAM, runner(NOK)))
    expect(card['photoUrl']).toBe(`http://localhost:9000/profile-service/${uploaded}`)
    expect('photoRef' in card).toBe(false)
  })

  it('removes the photo it replaces', async () => {
    await givenAProfile()
    const replacement = keyFor(NOK, '9d3a7c5e-1b2f-4a6c-8e0d-3f5b7a9c1e2d')
    storage.objects.add(uploaded)
    storage.objects.add(replacement)
    await attach(NOK, { photoRef: uploaded })
    await attach(NOK, { photoRef: replacement })
    expect(storage.removedKeys).toEqual([uploaded])
  })

  it('422 on photoRef for a key that was never uploaded', async () => {
    await givenAProfile()
    const response = await attach(NOK, { photoRef: uploaded })
    const body = await bodyOf(response)
    await expectContract('attachPhoto', 422, response)
    expect(body).toMatchObject({ code: 'validation_failed', fieldErrors: { photoRef: expect.any(String) } })
  })

  it('422 for another runner’s key, even one that exists, and nothing of theirs is removed', async () => {
    // Review Focus 5.
    await givenAProfile()
    const theirs = keyFor(BEAM)
    storage.objects.add(theirs)
    const response = await attach(NOK, { photoRef: theirs })
    const body = await bodyOf(response)
    await expectContract('attachPhoto', 422, response)

    expect(body).toMatchObject({ fieldErrors: { photoRef: expect.any(String) } })
    expect(storage.removedKeys).toEqual([])
    expect(storage.objects.has(theirs)).toBe(true)
  })

  it('422 on photoRef for a key whose dot segment climbs into another runner’s folder', async () => {
    // A store that normalises paths would find Beam's photo at this key; here the double holds it.
    await givenAProfile()
    const climbing = `photos/${NOK}/../${BEAM}/0b5f3c1e-7d2a-4e9b-8f61-2c4d6e8a0b1c`
    storage.objects.add(climbing)
    const response = await attach(NOK, { photoRef: climbing })
    const body = await bodyOf(response)
    await expectContract('attachPhoto', 422, response)
    expect(body).toMatchObject({ fieldErrors: { photoRef: expect.any(String) } })
  })

  it('422 when the body has no photoRef', async () => {
    await givenAProfile()
    await expectContract('attachPhoto', 422, await attach(NOK, { ref: uploaded }))
  })

  it('503 storage_unavailable when object storage cannot be asked', async () => {
    await givenAProfile()
    storage.unreachable = true
    await expectContract('attachPhoto', 503, await attach(NOK, { photoRef: uploaded }))
  })

  it('404 before the first save', async () => {
    await expectContract('attachPhoto', 404, await attach(NOK, { photoRef: uploaded }))
  })

  it('401 without a token', async () => {
    const response = await app.request(`${ME}/photo`, {
      method: 'PUT',
      body: JSON.stringify({ photoRef: uploaded }),
      headers: { 'content-type': 'application/json' },
    })
    await expectContract('attachPhoto', 401, response)
  })

  it('publishes ProfileUpdated with the photo', async () => {
    await givenAProfile()
    storage.objects.add(uploaded)
    events.published.length = 0
    await attach(NOK, { photoRef: uploaded })
    expect(events.published.at(-1)?.profile.photoRef).toBe(uploaded)
  })
})

describe('DELETE /api/v1/me/profile/photo — removePhoto', () => {
  const remove = (id: string): Promise<Response> => as(id, `${ME}/photo`, { method: 'DELETE' })
  const uploaded = keyFor(NOK)

  async function givenAPhoto(): Promise<void> {
    await givenAProfile()
    storage.objects.add(uploaded)
    const response = await as(NOK, `${ME}/photo`, { method: 'PUT', body: JSON.stringify({ photoRef: uploaded }) })
    expect(response.status).toBe(200)
  }

  it('200 takes the photo off, and removes it from storage', async () => {
    await givenAPhoto()
    const response = await remove(NOK)
    const body = await bodyOf(response)
    await expectContract('removePhoto', 200, response)

    expect(body).toMatchObject({ photoRef: null, photoUrl: null })
    expect(storage.removedKeys).toEqual([uploaded])
  })

  it('200 when there is no photo, changing nothing', async () => {
    await givenAProfile()
    await expectContract('removePhoto', 200, await remove(NOK))
    expect(storage.removedKeys).toEqual([])
  })

  it('200 while object storage is down — the photo comes off, and the object is logged as an orphan', async () => {
    // Review Focus 4.
    await givenAPhoto()
    storage.unreachable = true
    const response = await remove(NOK)
    await expectContract('removePhoto', 200, response.clone())

    expect((await bodyOf(response))['photoRef']).toBeNull()
    expect(orphaned).toEqual([NOK])
  })

  it('404 before the first save', async () => {
    await expectContract('removePhoto', 404, await remove(NOK))
  })

  it('401 without a token', async () => {
    await expectContract('removePhoto', 401, await app.request(`${ME}/photo`, { method: 'DELETE' }))
  })

  it('publishes ProfileUpdated without the photo', async () => {
    await givenAPhoto()
    events.published.length = 0
    await remove(NOK)
    expect(events.published.at(-1)?.profile.photoRef).toBeNull()
  })
})

describe('object storage down costs only photos', () => {
  it('saving, reading the profile and reading a card all still answer 200', async () => {
    // Review Focus 4: nothing but the photo routes asks storage.
    storage.unreachable = true
    await expectContract('saveProfile', 200, await save(NOK, minimal))
    await expectContract('getProfile', 200, await as(NOK, ME))
    await expectContract('getPublicProfile', 200, await as(BEAM, runner(NOK)))
  })
})

describe('an edit form that sends back what it read', () => {
  it('200, and the id, the hidden set and the photo stay as they were', async () => {
    // Review Focus 2: the owner's view, round-tripped through a save with one field changed.
    await givenAProfile()
    await as(NOK, `${ME}/visibility`, { method: 'PUT', body: JSON.stringify({ hiddenFields: ['bio'] }) })
    storage.objects.add(keyFor(NOK))
    await as(NOK, `${ME}/photo`, { method: 'PUT', body: JSON.stringify({ photoRef: keyFor(NOK) }) })

    const read = await bodyOf(await as(NOK, ME))
    const response = await save(NOK, { ...read, name: 'Nok R.' })
    const body = await bodyOf(response)
    await expectContract('saveProfile', 200, response)

    expect(body).toEqual({ ...read, name: 'Nok R.' })
  })
})

describe('the old paths are gone', () => {
  it.each([
    ['GET', `/v1/profiles/${NOK}`],
    ['PATCH', `/v1/profiles/${NOK}`],
    ['POST', `/v1/profiles/${NOK}/avatar-uploads`],
  ])('%s %s answers 404 not_found', async (method, path) => {
    const response = await as(NOK, path, { method })
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ code: 'not_found' })
  })
})

describe('GET /up', () => {
  it('200 without a token — it is the one public endpoint', async () => {
    const response = await app.request('/up')
    await expectContract('liveness', 200, response.clone())
    expect(await response.json()).toEqual({ status: 'ok' })
  })

  it('answers while the database is unreachable, because it never asks', async () => {
    const isolated = appWith(everyUseCase(() => Promise.reject(new Error('database is down'))))
    await expectContract('liveness', 200, await isolated.request('/up'))
  })
})

describe('the correlation id — X-Correlation-Id', () => {
  const given = 'abcdef01-2345-4678-89ab-cdef01234567'

  it('is current while the request is served, so the event publisher can pass it on (NFR-7.4)', async () => {
    const response = await as(NOK, ME, {
      method: 'PUT',
      body: JSON.stringify(minimal),
      headers: { 'x-correlation-id': given.toUpperCase() },
    })
    expect(response.status).toBe(200)
    expect(correlationIdWhenPublished).toBe(given)
  })

  it('is gone once the request is over', () => {
    expect(currentCorrelationId()).toBeUndefined()
  })

  it('keeps a UUID it is given, lowercased, and echoes it', async () => {
    const response = await app.request('/up', { headers: { 'x-correlation-id': given.toUpperCase() } })
    expect(response.headers.get('x-correlation-id')).toBe(given)
  })

  it('replaces a value that is not a UUID', async () => {
    const response = await app.request('/up', { headers: { 'x-correlation-id': 'abc123' } })
    expect(response.headers.get('x-correlation-id')).toMatch(UUID)
  })

  it('reads neither traceparent nor X-Request-Id, and writes no X-Request-Id', async () => {
    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736'
    const response = await app.request('/up', {
      headers: { traceparent: `00-${traceId}-00f067aa0ba902b7-01`, 'x-request-id': given },
    })
    expect(response.headers.get('x-correlation-id')).not.toBe(given)
    expect(response.headers.get('x-correlation-id')?.replaceAll('-', '')).not.toBe(traceId)
    expect(response.headers.get('x-request-id')).toBeNull()
  })

  it('is on every log line of the request, as correlationId', async () => {
    const lines: Record<string, unknown>[] = []
    const logger = pino({ level: 'info' }, { write: (line: string) => void lines.push(JSON.parse(line) as Record<string, unknown>) })
    const logged = appWith(everyUseCase(() => Promise.reject(new Error('the pool is on fire'))), { logger })
    const token = await identity.tokenFor(NOK)
    const response = await logged.request(ME, {
      headers: { authorization: `Bearer ${token}`, 'x-correlation-id': given },
    })
    expect(response.status).toBe(500)
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) {
      expect(line['correlationId']).toBe(given)
      expect('requestId' in line).toBe(false)
    }
  })
})

describe('an unexpected failure', () => {
  const brokenApp = (): Hono<Env> => appWith(everyUseCase(() => Promise.reject(new Error('the pool is on fire'))))

  it.each([
    ['getProfile', 'GET', ME, undefined],
    ['saveProfile', 'PUT', ME, JSON.stringify(minimal)],
    ['getPublicProfile', 'GET', runner(NOK), undefined],
    ['setFieldVisibility', 'PUT', `${ME}/visibility`, JSON.stringify({ hiddenFields: [] })],
    ['createPhotoUpload', 'POST', `${ME}/photo-uploads`, undefined],
    ['attachPhoto', 'PUT', `${ME}/photo`, JSON.stringify({ photoRef: `photos/${NOK}/abc` })],
    ['removePhoto', 'DELETE', `${ME}/photo`, undefined],
  ] as const)('%s becomes a 500 matching the default response', async (operationId, method, path, body) => {
    const token = await identity.tokenFor(NOK)
    const response = await brokenApp().request(path, {
      method,
      ...(body !== undefined && { body }),
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    })
    const payload = await bodyOf(response)

    await expectContract(operationId, 500, response)
    // A 500 deliberately says nothing useful — never the cause.
    expect(payload['code']).toBe('internal_error')
    expect('fieldErrors' in payload).toBe(false)
    expect(JSON.stringify(payload)).not.toContain('pool is on fire')
  })
})

describe('the edges of authentication', () => {
  it('accepts a lowercase scheme — RFC 9110 makes it case-insensitive', async () => {
    await givenAProfile()
    const token = await identity.tokenFor(NOK)
    const response = await app.request(ME, { headers: { authorization: `bearer ${token}` } })
    await expectContract('getProfile', 200, response)
  })

  it.each([
    ['signed with a secret Identity does not hold', { secret: 'not-identitys-secret' }],
    ['signed HS384 with the right secret — HS256 only', { alg: 'HS384' }],
    ['with no expiry, however well signed', { exp: undefined }],
    ['that has expired', { exp: Math.floor(Date.now() / 1000) - 60 }],
    ['with no subject', { sub: undefined }],
    ['whose subject is not a UUID', { sub: '7f3a9c2e15' }],
    ['with no issuer', { iss: undefined }],
    ['from another issuer', { iss: 'https://identity.example' }],
    ['with no audience', { aud: undefined }],
    ['for Identity’s refresh audience', { aud: 'cant-run-alone-services-refresh' }],
  ] as const)('401 for a token %s', async (_, changes) => {
    const token = await identity.tokenWith(NOK, changes)
    const response = await app.request(ME, { headers: { authorization: `Bearer ${token}` } })
    await expectContract('getProfile', 401, response)
  })

  it('takes the runner from the subject, lowercased', async () => {
    const id = 'abcdef01-2345-4678-89ab-cdef01234567'
    const token = await identity.tokenWith(id, { sub: id.toUpperCase() })
    const response = await app.request(ME, {
      method: 'PUT',
      body: JSON.stringify(minimal),
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    })
    const body = await bodyOf(response)
    await expectContract('saveProfile', 200, response)
    expect(body['id']).toBe(id)
  })
})

describe('an unmatched path', () => {
  it('answers in the same ApiError shape as every other error', async () => {
    const response = await as(NOK, '/api/v1/nothing-here')
    const body: unknown = await response.json()
    expect(response.status).toBe(404)
    expect(response.headers.get('x-correlation-id')).toMatch(UUID)
    expect(response.headers.get('content-type')).toContain('application/json')
    expectSchema('ApiError', body)
    expect(body).toMatchObject({ code: 'not_found', correlationId: response.headers.get('x-correlation-id') })
  })
})

describe('a SyntaxError from below the route', () => {
  it('is a 500, not a malformed body — the request had no body at all', async () => {
    const parsedBadJson = appWith(everyUseCase(() => Promise.reject(new SyntaxError('a driver parsed bad JSON'))))
    const token = await identity.tokenFor(NOK)
    const response = await parsedBadJson.request(ME, { headers: { authorization: `Bearer ${token}` } })
    await expectContract('getProfile', 500, response)
  })

  it('still answers 422 when the body really is not JSON', async () => {
    const token = await identity.tokenFor(NOK)
    const response = await app.request(ME, {
      method: 'PUT',
      body: '{ not json',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    })
    await expectContract('saveProfile', 422, response)
  })
})

describe('GET /ready', () => {
  const withReadiness = (readiness: typeof alwaysReady): Hono<Env> =>
    appWith(everyUseCase(() => Promise.reject(new Error('unused'))), { readiness })

  it('200 when serving — and no token needed, like /up', async () => {
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
    const throwing = { isDraining: () => false, canServe: () => Promise.reject(new Error('the pool exploded')) }
    const response = await withReadiness(throwing).request('/ready')
    const body = await response.clone().json()
    await expectContract('readiness', 503, response)
    expect(body).toEqual({ status: 'unavailable' })
  })

  it('503 when the database is out of reach — unlike /up, which does not ask', async () => {
    const unreachable = { isDraining: () => false, canServe: () => Promise.resolve(false) }
    const response = await withReadiness(unreachable).request('/ready')
    const body = await response.clone().json()
    await expectContract('readiness', 503, response)
    expect(body).toEqual({ status: 'unavailable' })

    // The same instance still reports itself alive: a drained or database-less process is not
    // a wedged one, and restarting it would fix nothing.
    await expectContract('liveness', 200, await withReadiness(unreachable).request('/up'))
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
    const response = await missing.request('/openapi.yaml')
    const body = await bodyOf(response)
    await expectContract('contract', 500, response)
    // The request context never ran here, and the error still has an id — the same in both places.
    expect(body['correlationId']).toBe(response.headers.get('x-correlation-id'))
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

describe('profile events — the use cases tell subscribers', () => {
  it('a save publishes ProfileUpdated with the saved profile', async () => {
    await expectContract('saveProfile', 200, await save(NOK, { ...minimal, bio: 'Hi' }))
    expect(events.published.map((event) => event.type)).toEqual(['updated'])
    expect(events.published.at(-1)?.profile.bio).toBe('Hi')
  })

  it('a refused save publishes nothing', async () => {
    await expectContract('saveProfile', 422, await save(NOK, { ...minimal, paceMin: 0 }))
    expect(events.published).toEqual([])
  })

  it('still answers 200 when Buddy Discovery is down (ADR-0019), and reports it', async () => {
    events.failWith = new Error('Buddy Discovery is down')
    await expectContract('saveProfile', 200, await save(NOK, minimal))
    await expectContract('saveProfile', 200, await save(NOK, minimal))
    expect(undelivered).toEqual([NOK, NOK])
  })
})

describe('the contract itself', () => {
  it('has every documented response exercised by at least one test', () => {
    expect([...exercised].sort()).toEqual([...documentedResponses].sort())
  })
})
