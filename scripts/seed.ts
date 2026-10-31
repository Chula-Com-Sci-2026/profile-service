import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { sql } from 'drizzle-orm'
import { saveProfile } from '../src/application/save-profile.ts'
import type { Profile } from '../src/domain/profile.ts'
import { loadDatabaseUrl, loadEventPublishing, loadObjectStorage } from '../src/infrastructure/config.ts'
import { createDatabase } from '../src/infrastructure/database.ts'
import { DrizzleProfileRepository } from '../src/infrastructure/drizzle-profile-repository.ts'
import { httpProfileEvents } from '../src/infrastructure/http-profile-events.ts'
import { identityServiceTokens } from '../src/infrastructure/identity-service-tokens.ts'
import { photoUrlFor } from '../src/infrastructure/photo-url.ts'
import { silentProfileEvents } from '../src/infrastructure/silent-profile-events.ts'
import { toContent } from '../src/interface/http/profile-input.ts'
import { profileSave } from '../src/interface/http/validators.ts'

/**
 * Loads `seed.json` into the database.
 *
 * Profiles go in through `saveProfile`, not a bulk INSERT, so a runner that breaks a §4 rule
 * fails here rather than landing in the table and failing the next time somebody reads it. Each
 * entry is validated with the same schema an API request would be — `id` comes from outside the
 * body, exactly as it does from the token.
 */
if (process.env['NODE_ENV'] === 'production') {
  console.error('refusing to seed: NODE_ENV is production, and this truncates the table first')
  process.exit(1)
}

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url))
const entries = JSON.parse(readFileSync(here('./seed.json'), 'utf8')) as unknown
if (!Array.isArray(entries)) throw new Error('seed.json must hold an array of runners')

const database = createDatabase(loadDatabaseUrl(), (error) => {
  console.error('an idle database connection failed:', error.message)
})

/**
 * The rows go in under a transaction, and an event must not leave before its change is
 * committed — so saves publish nothing, and each runner is published once the transaction
 * commits.
 */
const quiet = { events: silentProfileEvents, onUndelivered: () => {} }
const eventSettings = loadEventPublishing()
const publishing = {
  events:
    eventSettings === undefined
      ? silentProfileEvents
      : httpProfileEvents({
          subscribers: eventSettings.subscribers,
          tokens: identityServiceTokens({
            tokenUrl: eventSettings.identityTokenUrl,
            clientId: eventSettings.clientId,
            clientSecret: eventSettings.clientSecret,
          }),
          currentCorrelationId: () => undefined,
          photoUrl: photoUrlFor(loadObjectStorage()),
        }),
  onUndelivered: (id: string, error: unknown) => {
    console.error(`the event for ${id} was not delivered:`, error instanceof Error ? error.message : error)
  },
}
const seeded: Profile[] = []

try {
  // One transaction for the rows: a runner that breaks a §4 rule leaves the table as it was,
  // rather than emptied with whatever happened to save before the bad one.
  await database.db.transaction(async (tx) => {
    await tx.execute(sql`TRUNCATE profiles`)
    const save = saveProfile(new DrizzleProfileRepository(tx), quiet)

    for (const entry of entries) {
      if (typeof entry !== 'object' || entry === null) {
        throw new Error(`seed.json holds something that is not a runner: ${JSON.stringify(entry)}`)
      }
      const { id, ...body } = entry as { id?: unknown }
      if (typeof id !== 'string') {
        throw new Error(`a runner in seed.json has no id: ${JSON.stringify(entry)}`)
      }
      const profile = await save(id, toContent(profileSave.parse(body)))
      seeded.push(profile)
      console.log(`seeded  ${profile.id}  ${profile.name}`)
    }
  })

  for (const profile of seeded) {
    await publishing.events.updated(profile).catch((error: unknown) => publishing.onUndelivered(profile.id, error))
  }

  console.log(`\n${entries.length} runners seeded`)
} finally {
  await database.end()
}
