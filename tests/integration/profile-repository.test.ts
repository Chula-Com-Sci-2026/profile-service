import { sql } from 'drizzle-orm'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest'
import { InvalidProfileFieldError, ProfileAlreadyExistsError } from '../../src/domain/errors.ts'
import { Pace } from '../../src/domain/pace.ts'
import { PreferredDistance } from '../../src/domain/preferred-distance.ts'
import { PreferredRunTime } from '../../src/domain/preferred-run-time.ts'
import { Profile } from '../../src/domain/profile.ts'
import { Volume } from '../../src/domain/volume.ts'
import { DrizzleProfileRepository } from '../../src/infrastructure/drizzle-profile-repository.ts'

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
    userId: '7f3a9c2e15',
    displayName: 'Nok',
    bio: 'Chasing a sub-2 half.',
    avatarRef: 'avatars/7f3a9c2e15.jpg',
    birthYear: 1994,
    gender: 'female',
    area: 'lumphini',
    pace: new Pace(330),
    volume: new Volume(45_000),
    experience: 'intermediate',
    preferredDistances: [new PreferredDistance('marathon'), new PreferredDistance('10k')],
    preferredRunTimes: [new PreferredRunTime('sat', 'early_morning'), new PreferredRunTime('mon', 'evening')],
  })
}

function aMinimalProfile(): Profile {
  return new Profile({
    userId: 'b41d8e0a63',
    displayName: 'Beam',
    birthYear: 1990,
    preferredDistances: [],
    preferredRunTimes: [],
  })
}

describe('round trip', () => {
  it('returns every field it was given', async () => {
    await repository.insert(aFullProfile())
    const found = await repository.findById('7f3a9c2e15')

    expect(found).not.toBeNull()
    expect(found?.displayName).toBe('Nok')
    expect(found?.bio).toBe('Chasing a sub-2 half.')
    expect(found?.avatarRef).toBe('avatars/7f3a9c2e15.jpg')
    expect(found?.birthYear).toBe(1994)
    expect(found?.gender).toBe('female')
    expect(found?.area).toBe('lumphini')
    expect(found?.experience).toBe('intermediate')
  })

  it('brings back value objects, not bare numbers', async () => {
    await repository.insert(aFullProfile())
    const found = await repository.findById('7f3a9c2e15')

    expect(found?.pace).toBeInstanceOf(Pace)
    expect(found?.pace?.secondsPerKilometre).toBe(330)
    expect(found?.volume).toBeInstanceOf(Volume)
    expect(found?.volume?.metresPerWeek).toBe(45_000)
  })

  it('writes sets to the column already in declared order', async () => {
    // Read the raw column, not the mapped Profile: toDomain rebuilds a Profile and its
    // constructor re-sorts, so asserting through findById would pass whatever was stored.
    await repository.insert(aFullProfile())
    const result = await db.execute(
      sql`SELECT preferred_distances, preferred_run_times FROM profiles WHERE user_id = '7f3a9c2e15'`,
    )
    const row = result.rows[0]

    expect(row).toBeDefined()
    expect(row?.['preferred_distances']).toEqual(['10k', 'marathon'])
    expect(row?.['preferred_run_times']).toEqual([
      { dayOfWeek: 'mon', timeOfDay: 'evening' },
      { dayOfWeek: 'sat', timeOfDay: 'early_morning' },
    ])
  })

  it('leaves an unset scalar absent, never null and never empty', async () => {
    await repository.insert(aMinimalProfile())
    const found = await repository.findById('b41d8e0a63')

    expect(found).not.toBeNull()
    expect('bio' in (found as Profile)).toBe(false)
    expect('pace' in (found as Profile)).toBe(false)
    expect(found?.preferredDistances).toEqual([])
  })

  it('answers null for a runner with no profile', async () => {
    expect(await repository.findById('nobody')).toBeNull()
  })
})

describe('insert — one profile per runner (§5)', () => {
  it('raises a domain error on the second insert, not a driver error', async () => {
    await repository.insert(aFullProfile())
    await expect(repository.insert(aFullProfile())).rejects.toThrow(ProfileAlreadyExistsError)
  })

  it('names the runner in the error', async () => {
    await repository.insert(aFullProfile())
    await expect(repository.insert(aFullProfile())).rejects.toMatchObject({ userId: '7f3a9c2e15' })
  })

  it('leaves the stored profile untouched by the rejected insert', async () => {
    await repository.insert(aFullProfile())
    const clash = aFullProfile().update({ displayName: 'Someone Else' })
    await expect(repository.insert(clash)).rejects.toThrow(ProfileAlreadyExistsError)
    expect((await repository.findById('7f3a9c2e15'))?.displayName).toBe('Nok')
  })
})

describe('update', () => {
  it('persists the change and reports that a row moved', async () => {
    await repository.insert(aFullProfile())
    const changed = aFullProfile().update({ displayName: 'Nok R.', bio: null })

    expect(await repository.update(changed)).toBe(true)
    const found = await repository.findById('7f3a9c2e15')
    expect(found?.displayName).toBe('Nok R.')
    expect(found?.bio).toBeUndefined()
  })

  it('reports that nothing moved when there is no such profile', async () => {
    expect(await repository.update(aMinimalProfile())).toBe(false)
  })
})

describe('delete', () => {
  it('removes the profile and reports that a row went', async () => {
    await repository.insert(aFullProfile())
    expect(await repository.delete('7f3a9c2e15')).toBe(true)
    expect(await repository.findById('7f3a9c2e15')).toBeNull()
  })

  it('reports that nothing went when there is no such profile', async () => {
    expect(await repository.delete('nobody')).toBe(false)
  })
})

describe('row to domain is a boundary', () => {
  it('rejects a row the table was happy to store but §4 forbids', async () => {
    // The table enforces shape and the primary key. It has no opinion about gender.
    await db.execute(sql`
      INSERT INTO profiles (user_id, display_name, birth_year, gender, preferred_distances, preferred_run_times)
      VALUES ('2c9f5b7d10', 'Ploy', 1996, 'banana', '[]'::jsonb, '[]'::jsonb)
    `)
    await expect(repository.findById('2c9f5b7d10')).rejects.toThrow(InvalidProfileFieldError)
  })

  it.each([
    ["'null'::jsonb", 'JSON null'],
    ['\'"marathon"\'::jsonb', 'a bare string'],
    ["'{}'::jsonb", 'an object'],
  ])('rejects a set column holding %s — jsonb NOT NULL does not stop it', async (stored) => {
    await db.execute(
      sql.raw(`INSERT INTO profiles (user_id, display_name, birth_year, preferred_distances, preferred_run_times)
               VALUES ('shape', 'Ann', 1992, ${stored}, '[]'::jsonb)`),
    )
    await expect(repository.findById('shape')).rejects.toThrow(InvalidProfileFieldError)
  })

  it('rejects a set holding a member of the wrong type', async () => {
    await db.execute(sql`
      INSERT INTO profiles (user_id, display_name, birth_year, preferred_distances, preferred_run_times)
      VALUES ('member', 'Ann', 1992, '[42]'::jsonb, '[]'::jsonb)
    `)
    await expect(repository.findById('member')).rejects.toThrow(InvalidProfileFieldError)
  })

  it('rejects a run time missing half of its pair', async () => {
    await db.execute(sql`
      INSERT INTO profiles (user_id, display_name, birth_year, preferred_distances, preferred_run_times)
      VALUES ('pair', 'Ann', 1992, '[]'::jsonb, '[{"dayOfWeek":"mon"}]'::jsonb)
    `)
    await expect(repository.findById('pair')).rejects.toThrow(InvalidProfileFieldError)
  })

  it('rejects a stored value that is out of range', async () => {
    await db.execute(sql`
      INSERT INTO profiles (user_id, display_name, birth_year, pace, preferred_distances, preferred_run_times)
      VALUES ('e86a1f4c92', 'Bank', 1988, 20, '[]'::jsonb, '[]'::jsonb)
    `)
    await expect(repository.findById('e86a1f4c92')).rejects.toThrow(InvalidProfileFieldError)
  })
})
