import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { sql } from 'drizzle-orm'
import { createProfile } from '../src/application/create-profile.ts'
import type { AvatarStorage } from '../src/application/ports/avatar-storage.ts'
import { updateProfile } from '../src/application/update-profile.ts'
import { loadDatabaseUrl, loadObjectStorage } from '../src/infrastructure/config.ts'
import { createDatabase } from '../src/infrastructure/database.ts'
import { DrizzleProfileRepository } from '../src/infrastructure/drizzle-profile-repository.ts'
import { createAvatarStorage } from '../src/infrastructure/minio-avatar-storage.ts'
import { toFields } from '../src/interface/http/profile-input.ts'
import { profileWrite } from '../src/interface/http/validators.ts'

/**
 * Loads `seed.json` into the database, and `avatars/` into object storage.
 *
 * Profiles go in through `createProfile`, not a bulk INSERT, so a runner that breaks a §4 rule
 * fails here rather than landing in the table and failing the next time somebody reads it. Each
 * entry is validated with the same schema an API request would be — `userId` comes from outside
 * the body, exactly as it does from the path.
 *
 * Avatars go in the way a client would: ask for a presigned URL, PUT the bytes to it, then set
 * `avatarRef` through `updateProfile`. No shortcut through the S3 client, so seeding exercises
 * the same handshake the API offers — and the key cannot be written into seed.json, because it
 * carries a uuid that only exists once the upload is authorised.
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
const avatars: AvatarStorage = createAvatarStorage(loadObjectStorage())
const repository = new DrizzleProfileRepository(database.db)

/** Upload the bytes to the presigned URL, then record the key it minted. */
async function attachAvatar(userId: string): Promise<string | undefined> {
  const file = here(`./avatars/${userId}.png`)
  if (!existsSync(file)) return undefined

  const { uploadUrl, avatarRef } = await avatars.authoriseUpload(userId)
  // The URL is signed over the *public* endpoint, so whoever runs this must be able to reach it
  // — from the host in development, that is OBJECT_STORAGE_PUBLIC_ENDPOINT.
  const uploaded = await fetch(uploadUrl, { method: 'PUT', body: readFileSync(file) })
  if (!uploaded.ok) throw new Error(`uploading ${userId}'s avatar failed: ${uploaded.status}`)

  await updateProfile(repository, avatars, (id, error) => {
    console.error(`an avatar object was orphaned for ${id}:`, error)
  })(userId, { avatarRef })
  return avatarRef
}

try {
  // One transaction for the rows: a runner that breaks a §4 rule leaves the table as it was,
  // rather than emptied with whatever happened to insert before the bad one. Uploads happen
  // after it commits — holding a transaction open across network calls to storage would be a
  // poor trade for a demo seeder.
  await database.db.transaction(async (tx) => {
    await tx.execute(sql`TRUNCATE profiles`)
    const insert = createProfile(new DrizzleProfileRepository(tx))

    for (const entry of entries) {
      if (typeof entry !== 'object' || entry === null) {
        throw new Error(`seed.json holds something that is not a runner: ${JSON.stringify(entry)}`)
      }
      const { userId, ...body } = entry as { userId?: unknown }
      if (typeof userId !== 'string') {
        throw new Error(`a runner in seed.json has no userId: ${JSON.stringify(entry)}`)
      }
      const profile = await insert(toFields(userId, profileWrite.parse(body)))
      console.log(`seeded  ${profile.userId}  ${profile.displayName}`)
    }
  })

  for (const entry of entries as { userId: string; displayName: string }[]) {
    const avatarRef = await attachAvatar(entry.userId)
    if (avatarRef !== undefined) console.log(`avatar  ${entry.userId}  ${avatarRef}`)
  }

  console.log(`\n${entries.length} runners seeded`)
} finally {
  await database.end()
}
