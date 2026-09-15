import { readFileSync } from 'node:fs'
import { sql } from 'drizzle-orm'
import { createProfile } from '../src/application/create-profile.ts'
import { loadDatabaseUrl } from '../src/infrastructure/config.ts'
import { createDatabase } from '../src/infrastructure/database.ts'
import { DrizzleProfileRepository } from '../src/infrastructure/drizzle-profile-repository.ts'
import { toFields } from '../src/interface/http/profile-input.ts'
import { profileWrite } from '../src/interface/http/validators.ts'

/**
 * Loads `seed.json` into the database.
 *
 * It goes in through `createProfile`, not a bulk INSERT, so a runner that breaks a §4 rule
 * fails here rather than landing in the table and failing the next time somebody reads it.
 * Each entry is validated with the same schema an API request would be — `userId` comes from
 * outside the body, exactly as it does from the path.
 */
if (process.env['NODE_ENV'] === 'production') {
  console.error('refusing to seed: NODE_ENV is production, and this truncates the table first')
  process.exit(1)
}

const entries = JSON.parse(readFileSync(new URL('./seed.json', import.meta.url), 'utf8')) as unknown
if (!Array.isArray(entries)) throw new Error('seed.json must hold an array of runners')

const database = createDatabase(loadDatabaseUrl())
const insert = createProfile(new DrizzleProfileRepository(database.db))

try {
  await database.db.execute(sql`TRUNCATE profiles`)

  for (const entry of entries) {
    const { userId, ...body } = entry as { userId?: unknown }
    if (typeof userId !== 'string') throw new Error(`a runner in seed.json has no userId: ${JSON.stringify(entry)}`)
    const profile = await insert(toFields(userId, profileWrite.parse(body)))
    console.log(`seeded ${profile.userId}  ${profile.displayName}`)
  }

  console.log(`\n${entries.length} runners seeded`)
} finally {
  await database.end()
}
