import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import type { Database } from './database.ts'

/**
 * Applies everything in `drizzle/`.
 *
 * Shared by `src/migrate.ts` and the integration harness, so the migration path that ships is
 * the one every test run exercises — pool budgets included. They diverged once, and the
 * difference was invisible precisely because a document claimed it could not exist.
 *
 * The folder resolves against this module rather than the working directory, so it is found
 * from `src/` and from `dist/` alike.
 */
export function applyMigrations(database: Database): Promise<void> {
  return migrate(database.db, {
    migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
  })
}
