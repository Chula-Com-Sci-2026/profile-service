import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { loadDatabaseUrl } from './infrastructure/config.ts'
import { createDatabase } from './infrastructure/database.ts'

/**
 * Applies the migrations in `drizzle/`, then exits.
 *
 * A separate command, never something the service does on boot: three replicas starting
 * together would otherwise be three concurrent migrations against one schema. Same image,
 * different command.
 *
 * It uses drizzle-orm's migrator rather than the drizzle-kit CLI because drizzle-kit is a
 * devDependency and the runtime image is installed with `--omit=dev`. Using it here too, and
 * not only in the test harness, means the migration path that ships is the one that is
 * exercised on every integration run.
 *
 * The folder is resolved against this module, not the working directory, so it is found from
 * `src/migrate.ts` and from `dist/migrate.js` alike.
 */
const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url))

const database = createDatabase(loadDatabaseUrl(), (error) => {
  console.error('an idle database connection failed:', error.message)
})

try {
  await migrate(database.db, { migrationsFolder })
  console.log('migrations applied')
} finally {
  await database.end()
}
