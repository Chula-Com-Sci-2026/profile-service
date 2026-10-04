import { sql } from 'drizzle-orm'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest'
import { Area } from '../../src/domain/area.ts'
import { InvalidProfileFieldError, ProfileAlreadyExistsError } from '../../src/domain/errors.ts'
import { PaceRange } from '../../src/domain/pace-range.ts'
import { PreferredRunTime } from '../../src/domain/preferred-run-time.ts'
import { Profile } from '../../src/domain/profile.ts'
import { UsualDistance } from '../../src/domain/usual-distance.ts'
import { DrizzleProfileRepository } from '../../src/infrastructure/drizzle-profile-repository.ts'
import { CorruptProfileRowError } from '../../src/infrastructure/profile-mapper.ts'

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
    area: new Area(13.731723456, 100.541532),
    paceRange: new PaceRange(330, 390),
    usualDistance: new UsualDistance(10_000),
    experience: 'intermediate',
    preferredRunTimes: [new PreferredRunTime('sat', 'early_morning'), new PreferredRunTime('mon', 'evening')],
    gear: ['Pegasus 41', 'Forerunner 265'],
    hiddenFields: ['gender', 'birthYear'],
  })
}

function aMinimalProfile(): Profile {
  return new Profile({
    userId: 'b41d8e0a63',
    displayName: 'Beam',
    area: new Area(13.729, 100.559),
    preferredRunTimes: [],
    gear: [],
    hiddenFields: [],
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
    expect(found?.area.equals(new Area(13.731723456, 100.541532))).toBe(true)
    expect(found?.experience).toBe('intermediate')
    expect(found?.hiddenFields).toEqual(['birthYear', 'gender'])
  })

  it('brings back value objects, not bare numbers', async () => {
    await repository.insert(aFullProfile())
    const found = await repository.findById('7f3a9c2e15')

    expect(found?.paceRange).toBeInstanceOf(PaceRange)
    expect(found?.paceRange?.equals(new PaceRange(330, 390))).toBe(true)
    expect(found?.usualDistance).toBeInstanceOf(UsualDistance)
    expect(found?.usualDistance?.metres).toBe(10_000)
    expect(found?.gear).toEqual(['Pegasus 41', 'Forerunner 265'])
  })

  it('writes sets to the column already in declared order', async () => {
    // Read the raw column, not the mapped Profile: toDomain rebuilds a Profile and its
    // constructor re-sorts, so asserting through findById would pass whatever was stored.
    await repository.insert(aFullProfile())
    const result = await db.execute(
      sql`SELECT preferred_run_times FROM profiles WHERE user_id = '7f3a9c2e15'`,
    )
    const row = result.rows[0]

    expect(row).toBeDefined()
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
    expect('paceRange' in (found as Profile)).toBe(false)
    expect('birthYear' in (found as Profile)).toBe(false)
    expect(found?.gear).toEqual([])
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
  it('reports a corrupt row as our problem, keeping the field error as the cause', async () => {
    await db.execute(sql`
      INSERT INTO profiles (user_id, display_name, birth_year, area_latitude, area_longitude, gender, preferred_run_times)
      VALUES ('cause', 'Ann', 1992, 13.73, 100.54, 'banana', '[]'::jsonb)
    `)
    const error = await repository.findById('cause').catch((e: unknown) => e)

    expect(error).toBeInstanceOf(CorruptProfileRowError)
    expect((error as CorruptProfileRowError).userId).toBe('cause')
    expect((error as Error).cause).toBeInstanceOf(InvalidProfileFieldError)
  })

  it('rejects a row the table was happy to store but §4 forbids', async () => {
    // The table enforces shape and the primary key. It has no opinion about gender.
    await db.execute(sql`
      INSERT INTO profiles (user_id, display_name, birth_year, area_latitude, area_longitude, gender, preferred_run_times)
      VALUES ('2c9f5b7d10', 'Ploy', 1996, 13.73, 100.54, 'banana', '[]'::jsonb)
    `)
    await expect(repository.findById('2c9f5b7d10')).rejects.toThrow(CorruptProfileRowError)
  })

  it.each([
    ["'null'::jsonb", 'JSON null'],
    ['\'"marathon"\'::jsonb', 'a bare string'],
    ["'{}'::jsonb", 'an object'],
  ])('rejects a set column holding %s — jsonb NOT NULL does not stop it', async (stored) => {
    await db.execute(
      sql.raw(`INSERT INTO profiles (user_id, display_name, area_latitude, area_longitude, gear, preferred_run_times)
               VALUES ('shape', 'Ann', 13.73, 100.54, ${stored}, '[]'::jsonb)`),
    )
    await expect(repository.findById('shape')).rejects.toThrow(CorruptProfileRowError)
  })

  it('rejects a set holding a member of the wrong type', async () => {
    await db.execute(sql`
      INSERT INTO profiles (user_id, display_name, area_latitude, area_longitude, gear, preferred_run_times)
      VALUES ('member', 'Ann', 13.73, 100.54, '[42]'::jsonb, '[]'::jsonb)
    `)
    await expect(repository.findById('member')).rejects.toThrow(CorruptProfileRowError)
  })

  it('rejects a run time missing half of its pair', async () => {
    await db.execute(sql`
      INSERT INTO profiles (user_id, display_name, area_latitude, area_longitude, preferred_run_times)
      VALUES ('pair', 'Ann', 13.73, 100.54, '[{"dayOfWeek":"mon"}]'::jsonb)
    `)
    await expect(repository.findById('pair')).rejects.toThrow(CorruptProfileRowError)
  })

  it('rejects a stored value that is out of range', async () => {
    await db.execute(sql`
      INSERT INTO profiles (user_id, display_name, area_latitude, area_longitude, pace_fastest, pace_slowest, preferred_run_times)
      VALUES ('e86a1f4c92', 'Bank', 13.73, 100.54, 20, 400, '[]'::jsonb)
    `)
    await expect(repository.findById('e86a1f4c92')).rejects.toThrow(CorruptProfileRowError)
  })

  it('rejects a stored area that is off the map', async () => {
    // double precision holds 91 happily; §4 does not.
    await db.execute(sql`
      INSERT INTO profiles (user_id, display_name, area_latitude, area_longitude, preferred_run_times)
      VALUES ('offmap', 'Ann', 91, 100.54, '[]'::jsonb)
    `)
    await expect(repository.findById('offmap')).rejects.toThrow(CorruptProfileRowError)
  })

  it('refuses half a pace range at the table — both ends or neither is shape', async () => {
    const error = await db
      .execute(sql`
        INSERT INTO profiles (user_id, display_name, area_latitude, area_longitude, pace_fastest, preferred_run_times)
        VALUES ('half', 'Ann', 13.73, 100.54, 330, '[]'::jsonb)
      `)
      .catch((e: unknown) => e)

    // The driver error may be wrapped; find the layer carrying the SQLSTATE. Any other failure —
    // a misspelt column, say — must not pass for the constraint doing its job.
    let current: unknown = error
    while (current instanceof Error && !('code' in current)) current = current.cause
    expect(current).toMatchObject({ code: '23514', constraint: 'pace_range_has_both_ends' })
  })

  it('rejects a stored pace range whose fastest end is slower', async () => {
    await db.execute(sql`
      INSERT INTO profiles (user_id, display_name, area_latitude, area_longitude, pace_fastest, pace_slowest, preferred_run_times)
      VALUES ('reversed', 'Ann', 13.73, 100.54, 400, 330, '[]'::jsonb)
    `)
    await expect(repository.findById('reversed')).rejects.toThrow(CorruptProfileRowError)
  })

  it('rejects a stored hidden set naming a field that is always shown', async () => {
    await db.execute(sql`
      INSERT INTO profiles (user_id, display_name, area_latitude, area_longitude, preferred_run_times, hidden_fields)
      VALUES ('shown', 'Ann', 13.73, 100.54, '[]'::jsonb, '["displayName"]'::jsonb)
    `)
    await expect(repository.findById('shown')).rejects.toThrow(CorruptProfileRowError)
  })
})
