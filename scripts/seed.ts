import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { sql } from 'drizzle-orm'
import { attachPhoto } from '../src/application/attach-photo.ts'
import { createPhotoUpload } from '../src/application/create-photo-upload.ts'
import { StorageUnavailableError } from '../src/application/errors.ts'
import { saveProfile } from '../src/application/save-profile.ts'
import type { Profile } from '../src/domain/profile.ts'
import { loadDatabaseUrl, loadObjectStorage } from '../src/infrastructure/config.ts'
import { createDatabase } from '../src/infrastructure/database.ts'
import { DrizzleProfileRepository } from '../src/infrastructure/drizzle-profile-repository.ts'
import { createPhotoStorage } from '../src/infrastructure/minio-photo-storage.ts'
import { silentProfileEvents } from '../src/infrastructure/silent-profile-events.ts'
import { toContent } from '../src/interface/http/profile-input.ts'
import { profileSave } from '../src/interface/http/validators.ts'
import { seedPhotos } from './seed-photos.ts'

/**
 * Loads `seed.json` into the database, and `photos/` into object storage.
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
const storageSettings = loadObjectStorage()
const photos = createPhotoStorage(storageSettings)
const repository = new DrizzleProfileRepository(database.db)

/** Nothing sends profile events until the outbox relays them. */
const quiet = { events: silentProfileEvents, onUndelivered: () => {} }
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

  // After the rows commit: holding a transaction open across calls to storage would be a poor trade
  // for a demo seeder. A runner with no photos/{id}.png simply has no photo.
  const attached = await seedPhotos(
    seeded.map((profile) => profile.id),
    {
      createPhotoUpload: createPhotoUpload(repository, photos),
      attachPhoto: attachPhoto(repository, photos, (id, error) => console.error(`a photo object was orphaned for ${id}:`, error), quiet),
      photoOf: (id) => {
        const file = here(`./photos/${id}.png`)
        return existsSync(file) ? readFileSync(file) : undefined
      },
      // The URL is signed over the *public* endpoint, so whoever runs this must be able to reach
      // it — from the host in development, that is OBJECT_STORAGE_PUBLIC_ENDPOINT.
      put: (url, bytes) =>
        fetch(url, { method: 'PUT', body: bytes }).catch((error: unknown) => {
          throw new StorageUnavailableError(error)
        }),
      log: (line) => console.log(line),
      warn: (line) => console.warn(line),
    },
  )

  console.log(`\n${entries.length} runners seeded, ${attached} with photos`)
} finally {
  await database.end()
}
