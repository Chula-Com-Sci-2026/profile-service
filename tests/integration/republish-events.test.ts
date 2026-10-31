import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import { sql } from 'drizzle-orm'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest'
import { saveProfile } from '../../src/application/save-profile.ts'
import type { ProfileContent } from '../../src/domain/profile.ts'
import { drizzleUnitOfWork } from '../../src/infrastructure/drizzle-unit-of-work.ts'
import type { ProfileUpdatedEvent } from '../../src/infrastructure/profile-published-language.ts'
import { expectProfileEvent } from '../unit/infrastructure/event-contract.ts'

/**
 * `npm run events:republish`, run as the command it is — `node src/republish-events.ts` — against
 * the suite's database, with nothing in its environment but what it needs.
 */
const run = promisify(execFile)
const NOK = '33333333-3333-4333-8333-333333333333'
const BEAM = '44444444-4444-4444-8444-444444444444'
const content: ProfileContent = {
  name: 'Nok',
  paceMin: 7,
  paceMax: 8,
  experience: 'Beginner',
  area: 'Lumphini Park',
  latitude: 13.7314,
  longitude: 100.5414,
  availability: 'Sat early mornings',
}

let pool: pg.Pool
let db: NodePgDatabase

beforeAll(() => {
  pool = new pg.Pool({ connectionString: inject('databaseUrl') })
  db = drizzle(pool)
})

afterAll(async () => {
  await pool.end()
})

beforeEach(async () => {
  await db.execute(sql`TRUNCATE profiles, outbox`)
  const save = saveProfile(
    drizzleUnitOfWork(db, { photoUrl: (photoRef) => `http://localhost:9000/profile-service/${photoRef}`, correlationId: () => randomUUID() }),
  )
  await save(NOK, content)
  await save(NOK, { ...content, name: 'Nok R.' })
  await save(BEAM, { ...content, name: 'Beam' })
  await db.execute(sql`TRUNCATE outbox`)
})

/** Runs the command, failing the test with its stderr when it exits non-zero. */
async function republish(): Promise<{ stdout: string }> {
  const env = {
    PATH: process.env['PATH'] ?? '',
    DATABASE_URL: inject('databaseUrl'),
    OBJECT_STORAGE_PUBLIC_ENDPOINT: 'http://localhost:9000',
    OBJECT_STORAGE_BUCKET: 'profile-service',
  }
  try {
    return await run(process.execPath, ['src/republish-events.ts'], { env })
  } catch (error) {
    throw new Error(`events:republish failed: ${(error as { stderr?: string }).stderr ?? String(error)}`, { cause: error })
  }
}

async function outbox(): Promise<{ payload: ProfileUpdatedEvent; published_at: string | null }[]> {
  const result = await db.execute(sql`SELECT payload, published_at FROM outbox ORDER BY sequence`)
  return result.rows as { payload: ProfileUpdatedEvent; published_at: string | null }[]
}

describe('npm run events:republish', () => {
  it('writes one row per profile with its revision unchanged, one correlationId for the run, and prints the count', async () => {
    const { stdout } = await republish()
    expect(stdout).toMatch(/^2 profile events written to the outbox/m)

    const events = (await outbox()).map((row) => row.payload)
    expect(events.map((event) => [event.payload.id, event.payload.revision])).toEqual([
      [NOK, 2],
      [BEAM, 1],
    ])
    expect(new Set(events.map((event) => event.correlationId)).size).toBe(1)
    expect(new Set(events.map((event) => event.eventId)).size).toBe(2)
    for (const event of events) expectProfileEvent(event)

    const revisions = await db.execute(sql`SELECT id, revision FROM profiles ORDER BY id`)
    expect(revisions.rows).toEqual([
      { id: NOK, revision: 2 },
      { id: BEAM, revision: 1 },
    ])
  })

  it('sends nothing itself: every row it wrote waits unsent', async () => {
    await republish()
    expect((await outbox()).map((row) => row.published_at)).toEqual([null, null])
  })
})

