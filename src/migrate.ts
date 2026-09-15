import { loadDatabaseUrl } from './infrastructure/config.ts'
import { MIGRATION_BUDGETS, createDatabase } from './infrastructure/database.ts'
import { applyMigrations } from './infrastructure/migrations.ts'

/**
 * Applies the migrations in `drizzle/`, then exits.
 *
 * A separate command, never something the service does on boot: three replicas starting
 * together would otherwise be three concurrent migrations against one schema. Same image,
 * different command.
 *
 * MIGRATION_BUDGETS rather than the request-path ones — a migration may legitimately run for
 * minutes, and the two-second query limit that protects a request would abort it.
 */
const database = createDatabase(
  loadDatabaseUrl(),
  (error) => console.error('an idle database connection failed:', error.message),
  MIGRATION_BUDGETS,
)

try {
  await applyMigrations(database)
  console.log('migrations applied')
} catch (error) {
  // Without this the cause surfaces as an unhandled rejection, and a pool that fails to close
  // afterwards would replace it — so a failed deploy would show the wrong error.
  console.error('migrations failed:', error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  await database.end().catch(() => undefined)
}
