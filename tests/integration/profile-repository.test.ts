import { sql } from 'drizzle-orm'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest'
import { InvalidProfileFieldError, ProfileAlreadyExistsError } from '../../src/domain/errors.ts'
import { Profile } from '../../src/domain/profile.ts'
import { DrizzleProfileRepository } from '../../src/infrastructure/drizzle-profile-repository.ts'
import { CorruptProfileRowError } from '../../src/infrastructure/profile-mapper.ts'

const RAY = '11111111-1111-4111-8111-111111111111'
const BEAM = '44444444-4444-4444-8444-444444444444'
const PHOTO = `photos/${RAY}/0b5f3c1e-7d2a-4e9b-8f61-2c4d6e8a0b1c`

let pool: pg.Pool
let db: NodePgDatabase
let repository: DrizzleProfileRepository

beforeAll(() => {
  pool = new pg.Pool({ connectionString: inject('databaseUrl') })
  db = drizzle(pool)
  repository = new DrizzleProfileRepository(db)
})

afterAll(async () => {
  await pool.end()
})

beforeEach(async () => {
  await db.execute(sql`TRUNCATE profiles`)
})

function aFullProfile(): Profile {
  return new Profile({
    id: RAY,
    name: 'Ray Attajak',
    bio: 'Chasing a sub-2 half.',
    paceMin: 380 / 60,
    paceMax: 6.5,
    experience: 'Intermediate',
    area: 'Lumphini area',
    latitude: 13.731723456,
    longitude: 100.541532,
    availability: 'Tue & Thu evenings',
    usualDistance: '5–10 km',
    gear: ['Pegasus 41', 'Forerunner 265'],
    photoRef: PHOTO,
    hiddenFields: ['gear', 'bio'],
  })
}

function aMinimalProfile(): Profile {
  return Profile.create(BEAM, {
    name: 'Beam',
    paceMin: 5,
    paceMax: 6,
    experience: 'Beginner',
    area: 'Benjakitti Park',
    latitude: 13.729,
    longitude: 100.559,
    availability: 'Weekends',
  })
}

/** A row the table accepts, with one column set by hand — for the boundary tests below. */
async function insertRow(column: string, value: string): Promise<void> {
  const row: Record<string, string> = {
    id: `'${RAY}'`,
    name: `'Ann'`,
    pace_min: '5',
    pace_max: '6',
    experience: `'Advanced'`,
    area: `'Lumphini Park'`,
    latitude: '13.73',
    longitude: '100.54',
    availability: `'Nights'`,
    [column]: value,
  }
  await db.execute(sql.raw(`INSERT INTO profiles (${Object.keys(row).join(', ')}) VALUES (${Object.values(row).join(', ')})`))
}

describe('round trip', () => {
  it('returns every field it was given, under the same names', async () => {
    await repository.insert(aFullProfile())
    expect(await repository.findById(RAY)).toEqual(aFullProfile())
  })

  it('keeps the pace and the point exactly, as double precision', async () => {
    await repository.insert(aFullProfile())
    const found = await repository.findById(RAY)
    expect(found?.paceMin).toBe(6.333333333333333)
    expect(found?.latitude).toBe(13.731723456)
  })

  it('leaves an unset field null, never absent and never empty', async () => {
    await repository.insert(aMinimalProfile())
    const found = await repository.findById(BEAM)

    expect(found).not.toBeNull()
    expect([found?.bio, found?.usualDistance, found?.gear, found?.photoRef]).toEqual([null, null, null, null])
    expect(found?.hiddenFields).toEqual([])
  })

  it('stores no gear as SQL NULL, not as []', async () => {
    await repository.insert(aMinimalProfile())
    const result = await db.execute(sql`SELECT gear FROM profiles WHERE id = ${BEAM}`)
    expect(result.rows[0]?.['gear']).toBeNull()
  })

  it('writes the hidden set to the column already in declared order', async () => {
    // Read the raw column, not the mapped Profile: toDomain rebuilds a Profile and its
    // constructor re-sorts, so asserting through findById would pass whatever was stored.
    await repository.insert(aFullProfile())
    const result = await db.execute(sql`SELECT hidden_fields FROM profiles WHERE id = ${RAY}`)
    expect(result.rows[0]?.['hidden_fields']).toEqual(['bio', 'gear'])
  })

  it('answers null for a runner with no profile', async () => {
    expect(await repository.findById(BEAM)).toBeNull()
  })

  it.each(['not-a-uuid', 'x'.repeat(100), ''])(
    'answers null for %j, which is not an id, without the uuid column raising',
    async (id) => {
      await repository.insert(aFullProfile())
      expect(await repository.findById(id)).toBeNull()
    },
  )

  it('answers null for an id in uppercase — ids are lowercase, and the edge lowercases what it is sent', async () => {
    const lettered = 'abcdef01-2345-4678-89ab-cdef01234567'
    await repository.insert(Profile.create(lettered, { name: 'Ann', paceMin: 5, paceMax: 6, experience: 'Advanced', area: 'Lumphini Park', latitude: 13.73, longitude: 100.54, availability: 'Nights' }))
    expect(await repository.findById(lettered)).not.toBeNull()
    expect(await repository.findById(lettered.toUpperCase())).toBeNull()
  })
})

describe('insert — one profile per runner (§5)', () => {
  it('raises a domain error on the second insert, naming the runner, not a driver error', async () => {
    await repository.insert(aFullProfile())
    await expect(repository.insert(aFullProfile())).rejects.toThrow(ProfileAlreadyExistsError)
    await expect(repository.insert(aFullProfile())).rejects.toMatchObject({ id: RAY })
  })

  it('leaves the stored profile untouched by the rejected insert', async () => {
    await repository.insert(aFullProfile())
    const clash = new Profile({ ...aFullProfile(), name: 'Someone Else' } as ConstructorParameters<typeof Profile>[0])
    await expect(repository.insert(clash)).rejects.toThrow(ProfileAlreadyExistsError)
    expect((await repository.findById(RAY))?.name).toBe('Ray Attajak')
  })
})

describe('update', () => {
  it('persists the change and reports that a row moved', async () => {
    await repository.insert(aFullProfile())
    const changed = aFullProfile().save({
      name: 'Ray A.',
      paceMin: 6,
      paceMax: 6.5,
      experience: 'Intermediate',
      area: 'Lumphini area',
      latitude: 13.7308,
      longitude: 100.5418,
      availability: 'Tue & Thu evenings',
      gear: null,
    })

    expect(await repository.update(changed)).toBe(true)
    const found = await repository.findById(RAY)
    expect(found?.name).toBe('Ray A.')
    expect(found?.bio).toBeNull()
    expect(found?.gear).toBeNull()
  })

  it('reports that nothing moved when there is no such profile', async () => {
    expect(await repository.update(aMinimalProfile())).toBe(false)
  })
})

describe('row to domain is a boundary', () => {
  it('reports a corrupt row as our problem, keeping the field error as the cause', async () => {
    await insertRow('experience', `'beginner'`)
    const error = await repository.findById(RAY).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(CorruptProfileRowError)
    expect((error as CorruptProfileRowError).id).toBe(RAY)
    expect((error as Error).cause).toBeInstanceOf(InvalidProfileFieldError)
  })

  it.each([
    ['usual_distance', `'5-10 km'`, 'a hyphen for the en dash'],
    ['gear', `'"marathon"'::jsonb`, 'gear as a bare string — jsonb does not stop it'],
    ['gear', `'[42]'::jsonb`, 'gear holding something that is not text'],
    ['hidden_fields', `'["name"]'::jsonb`, 'a hidden set naming a field that is always shown'],
    ['hidden_fields', `'null'::jsonb`, 'a hidden set of JSON null — jsonb NOT NULL does not stop it'],
    ['pace_min', `0`, 'a pace of zero'],
    ['pace_min', `7`, 'a paceMin slower than paceMax'],
    ['latitude', `91`, 'a point off the map'],
  ])('rejects %s = %s — %s', async (column, value) => {
    await insertRow(column, value)
    await expect(repository.findById(RAY)).rejects.toThrow(CorruptProfileRowError)
  })
})
