import { readFileSync, readdirSync } from 'node:fs'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'

/**
 * Migration 0002 is the one step that must keep data: a runner's single pace becomes a range of
 * zero width. It runs here against a scratch database, from the SQL files themselves.
 */
const SCRATCH = 'migration_0002'
let admin: pg.Client
let scratch: pg.Client

function statements(prefix: string): string[] {
  const file = readdirSync('drizzle').find((name) => name.startsWith(prefix) && name.endsWith('.sql'))
  if (file === undefined) throw new Error(`no migration starting ${prefix}`)
  return readFileSync(`drizzle/${file}`, 'utf8')
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)
}

async function apply(prefix: string): Promise<void> {
  for (const statement of statements(prefix)) await scratch.query(statement)
}

beforeAll(async () => {
  admin = new pg.Client({ connectionString: inject('databaseUrl') })
  await admin.connect()
  await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH}`)
  await admin.query(`CREATE DATABASE ${SCRATCH}`)
  const url = new URL(inject('databaseUrl'))
  url.pathname = `/${SCRATCH}`
  scratch = new pg.Client({ connectionString: url.toString() })
  await scratch.connect()
})

afterAll(async () => {
  await scratch.end()
  await admin.query(`DROP DATABASE ${SCRATCH}`)
  await admin.end()
})

describe('migration 0002 — the profile fields follow the team glossary', () => {
  it('keeps a runner’s pace as a range of zero width, and drops volume and preferred distances', async () => {
    await apply('0000_')
    await apply('0001_')
    await scratch.query(`
      INSERT INTO profiles (user_id, display_name, birth_year, area_latitude, area_longitude, pace, volume, preferred_distances, preferred_run_times)
      VALUES ('7f3a9c2e15', 'Nok', 1994, 13.73, 100.54, 330, 42000, '["10k"]'::jsonb, '[]'::jsonb)
    `)

    await apply('0002_')

    const { rows } = await scratch.query<Record<string, unknown>>('SELECT * FROM profiles')
    expect(rows[0]).toMatchObject({ pace_fastest: 330, pace_slowest: 330, birth_year: 1994, gear: [] })
    expect(rows[0]).not.toHaveProperty('pace')
    expect(rows[0]).not.toHaveProperty('volume')
    expect(rows[0]).not.toHaveProperty('preferred_distances')
  })
})
