import { setTimeout as delay } from 'node:timers/promises'
import { sql } from 'drizzle-orm'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest'
import type { UnitOfWork } from '../../src/application/ports/unit-of-work.ts'
import { saveProfile } from '../../src/application/save-profile.ts'
import { Profile, type ProfileContent } from '../../src/domain/profile.ts'
import { drizzleUnitOfWork } from '../../src/infrastructure/drizzle-unit-of-work.ts'
import type { ProfileUpdatedEvent } from '../../src/infrastructure/profile-published-language.ts'
import { expectProfileEvent } from '../unit/infrastructure/event-contract.ts'

/**
 * The unit of work against real PostgreSQL: a change and its event commit together, and a conflict
 * is retried in a transaction of its own — the only way to recover from a unique violation, which
 * aborts the transaction it happens in.
 *
 * The races are made deterministic with a second connection, the "blocker", that holds a write
 * uncommitted. The save under test reads around it, then waits on its lock; once the save is seen
 * waiting, the blocker commits, and the save meets the conflict.
 */
const NOK = '33333333-3333-4333-8333-333333333333'
const CORRELATION = 'abcdef01-2345-4678-89ab-cdef01234567'
const options = {
  photoUrl: (photoRef: string): string => `http://localhost:9000/profile-service/${photoRef}`,
  correlationId: () => CORRELATION,
}

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
let unitOfWork: UnitOfWork
let blocker: pg.Client

beforeAll(() => {
  pool = new pg.Pool({ connectionString: inject('databaseUrl') })
  db = drizzle(pool)
  unitOfWork = drizzleUnitOfWork(db, options)
})

afterAll(async () => {
  await pool.end()
})

beforeEach(async () => {
  await db.execute(sql`TRUNCATE profiles, outbox`)
  blocker = new pg.Client({ connectionString: inject('databaseUrl') })
  await blocker.connect()
})

afterEach(async () => {
  await blocker.end()
})

/** A raw row. drizzle's driver setup hands timestamps back as text, so they are read through `new Date()`. */
type OutboxRow = { event_id: string; event_type: string; payload: ProfileUpdatedEvent; occurred_at: string; published_at: string | null }

async function outboxRows(): Promise<OutboxRow[]> {
  const result = await db.execute(sql`SELECT event_id, event_type, payload, occurred_at, published_at FROM outbox ORDER BY sequence`)
  return result.rows as OutboxRow[]
}

async function count(table: 'profiles' | 'outbox'): Promise<number> {
  const result = await db.execute(sql.raw(`SELECT count(*)::int AS n FROM ${table}`))
  return (result.rows[0] as { n: number }).n
}

/** Nok's row, as another request would insert it — revision 1, under the name given. */
const insertNok = (name: string): string =>
  `INSERT INTO profiles (id, name, pace_min, pace_max, experience, area, latitude, longitude, availability, revision)
   VALUES ('${NOK}', '${name}', 7, 8, 'Beginner', 'Lumphini Park', 13.7314, 100.5414, 'Sat early mornings', 1)`

/** Waits until some backend is waiting on a lock — the save under test, held by the blocker. */
async function untilBlocked(): Promise<void> {
  for (let tries = 0; tries < 250; tries += 1) {
    const result = await pool.query(
      `SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()`,
    )
    if ((result.rows[0] as { n: number }).n > 0) return
    await delay(20)
  }
  throw new Error('nothing ever waited on the blocker’s lock')
}

describe('a change and its ProfileUpdated', () => {
  it('commit together', async () => {
    const saved = await saveProfile(unitOfWork)(NOK, content)

    const [row, ...rest] = await outboxRows()
    expect(rest).toEqual([])
    expect(row).toMatchObject({ event_type: 'ProfileUpdated', published_at: null })
    expect(row?.payload).toMatchObject({ eventId: row?.event_id, correlationId: CORRELATION, payload: { id: NOK, revision: 1 } })
    expect(new Date(row?.payload.occurredAt ?? '').getTime()).toBe(new Date(row?.occurred_at ?? '').getTime())
    expectProfileEvent(row?.payload)
    expect(saved.revision).toBe(1)
  })

  it('both roll back when the work fails after writing them', async () => {
    await expect(
      unitOfWork.run(async ({ profiles, events }) => {
        const created = Profile.create(NOK, content)
        await profiles.insert(created)
        await events.updated(created)
        throw new Error('after both writes')
      }),
    ).rejects.toThrow('after both writes')

    expect([await count('profiles'), await count('outbox')]).toEqual([0, 0])
  })
})

describe('a conflict is retried in a transaction of its own (domain.md §5)', () => {
  it('a lost first-save race is retried in a fresh transaction', async () => {
    // Review Focus 5. The save reads "none", its insert waits on the blocker's key, the blocker
    // commits, the insert meets 23505 — which aborts that transaction — and the retry, in a new one,
    // reads the blocker's profile and saves over it.
    await blocker.query('BEGIN')
    await blocker.query(insertNok('Other tab'))

    const saving = saveProfile(unitOfWork)(NOK, { ...content, name: 'Nok R.' })
    await untilBlocked()
    await blocker.query('COMMIT')

    expect(await saving).toMatchObject({ name: 'Nok R.', revision: 2 })
    expect((await outboxRows()).map((row) => row.payload.payload.revision)).toEqual([2])
  })

  it('a lost first-save race is retried inside an outer transaction, as the seed runs it — a savepoint per attempt', async () => {
    await blocker.query('BEGIN')
    await blocker.query(insertNok('Other tab'))

    const seeding = db.transaction((tx) => saveProfile(drizzleUnitOfWork(tx, options))(NOK, { ...content, name: 'Nok R.' }))
    await untilBlocked()
    await blocker.query('COMMIT')

    expect(await seeding).toMatchObject({ name: 'Nok R.', revision: 2 })
    expect((await outboxRows()).map((row) => row.payload.payload.revision)).toEqual([2])
  })

  it('a change saved first moves the revision; the later one is made again on it', async () => {
    // Review Focus 3: a save in one tab while a visibility change from another is committing.
    await saveProfile(unitOfWork)(NOK, content)
    await blocker.query('BEGIN')
    await blocker.query(`UPDATE profiles SET hidden_fields = '["bio"]', revision = 2 WHERE id = '${NOK}'`)

    const saving = saveProfile(unitOfWork)(NOK, { ...content, name: 'Nok R.' })
    await untilBlocked()
    await blocker.query('COMMIT')

    expect(await saving).toMatchObject({ name: 'Nok R.', hiddenFields: ['bio'], revision: 3 })
    expect((await outboxRows()).map((row) => row.payload.payload.revision)).toEqual([1, 3])
  })
})
