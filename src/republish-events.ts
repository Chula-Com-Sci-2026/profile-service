import { randomUUID } from 'node:crypto'
import { republishProfiles } from './application/republish-profiles.ts'
import { loadDatabaseUrl, loadPhotoAddress } from './infrastructure/config.ts'
import { createDatabase } from './infrastructure/database.ts'
import { drizzleUnitOfWork } from './infrastructure/drizzle-unit-of-work.ts'
import { photoUrlFor } from './infrastructure/photo-url.ts'

/**
 * Writes every profile's ProfileUpdated to the outbox again, under its unchanged revision, then
 * exits. `npm run events:republish`, or in the image `node dist/republish-events.js` — the same
 * artifact as the service, run differently, as `migrate.js` is.
 *
 * Run on purpose: when Buddy Discovery's consumer goes live, after its copy is wiped, after a bug in
 * it. It sends nothing itself; the running service's relay sends what it wrote. One correlation id
 * for the run, so the whole republish can be found in every log that carries it.
 */
const database = createDatabase(loadDatabaseUrl(), (error) => console.error('an idle database connection failed:', error.message))
const correlationId = randomUUID()
const republish = republishProfiles(
  drizzleUnitOfWork(database.db, { photoUrl: photoUrlFor(loadPhotoAddress()), correlationId: () => correlationId }),
)

try {
  const count = await republish()
  console.log(
    `${count} profile events written to the outbox (correlationId ${correlationId}); the running service sends them`,
  )
} catch (error) {
  console.error('republishing failed:', error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  await database.end().catch(() => undefined)
}
