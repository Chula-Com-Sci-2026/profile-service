import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { stdSerializers } from 'pino'
import { beforeAll, describe, expect, it } from 'vitest'
import { Area } from '../../../src/domain/area.ts'
import { Profile } from '../../../src/domain/profile.ts'
import { DrizzleProfileRepository } from '../../../src/infrastructure/drizzle-profile-repository.ts'

/**
 * A write that fails at the database must not carry the row into the log.
 *
 * drizzle wraps every failed query with its parameters in the message, the stack and a `params`
 * property, and the error handler logs whatever reaches it — so an outage during a PUT would
 * write the runner's exact area to stdout. domain.md keeps that point inside this service.
 */
let repository: DrizzleProfileRepository

beforeAll(async () => {
  // An ended pool refuses every query without touching the network: a database failure on demand.
  const pool = new pg.Pool({ connectionString: 'postgres://nobody@127.0.0.1:1/none' })
  await pool.end()
  repository = new DrizzleProfileRepository(drizzle(pool))
})

const profile = new Profile({
  userId: '7f3a9c2e15',
  displayName: 'Nok',
  birthYear: 1994,
  bio: 'Chasing a sub-2 half.',
  area: new Area(13.731723456, 100.541532),
  preferredDistances: [],
  preferredRunTimes: [],
})

/** What pino writes for `{ err }`, cause chain included. */
async function loggedFailureOf(write: Promise<unknown>): Promise<string> {
  const error = await write.then(
    () => expect.fail('the write should have failed'),
    (e: unknown) => e,
  )
  return JSON.stringify([stdSerializers.err(error as Error), stdSerializers.errWithCause(error as Error)])
}

describe.each([
  ['insert', () => repository.insert(profile)],
  ['update', () => repository.update(profile)],
] as const)('%s — a failure at the database', (_, write) => {
  it('logs none of the values it tried to write', async () => {
    const logged = await loggedFailureOf(write())

    expect(logged).not.toContain('13.731723456')
    expect(logged).not.toContain('100.541532')
    expect(logged).not.toContain('Chasing a sub-2 half.')
  })

  it('still says what went wrong, and in which statement', async () => {
    const logged = await loggedFailureOf(write())

    expect(logged).toContain('Cannot use a pool after calling end on the pool')
    expect(logged).toMatch(/(insert into|update) \\"profiles\\"/)
  })
})
