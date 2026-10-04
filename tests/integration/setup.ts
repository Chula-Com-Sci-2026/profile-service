import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import type { TestProject } from 'vitest/node'
import { MIGRATION_BUDGETS, createDatabase } from '../../src/infrastructure/database.ts'
import { applyMigrations } from '../../src/infrastructure/migrations.ts'

/**
 * The integration suite brings its own database.
 *
 * `git clone && npm ci && npm run test:int` passes on a machine that has never seen this
 * project: no port to free, no database to create by hand, no second environment variable.
 * `docker-compose.yml` is untouched and still serves `npm run dev` and `db:seed`.
 *
 * The image tag is also in `docker-compose.yml` — the two must move together.
 */
const POSTGRES_IMAGE = 'postgres:16-alpine'

let container: StartedPostgreSqlContainer

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  container = await new PostgreSqlContainer(POSTGRES_IMAGE).start()
  const stop = async (): Promise<void> => {
    await container.stop()
  }

  try {
    const databaseUrl = container.getConnectionUri()

    // Migrate once, here — a suite that migrates per file races itself. Through the same
    // code and the same pool budgets the image uses, so the two cannot drift apart unnoticed.
    const database = createDatabase(databaseUrl, () => undefined, MIGRATION_BUDGETS)
    try {
      await applyMigrations(database)
    } finally {
      await database.end()
    }

    project.provide('databaseUrl', databaseUrl)
    return stop
  } catch (error) {
    // The teardown closure is only handed back on success, so stop the container ourselves
    // rather than leaving one running for every failed migration.
    await stop()
    throw error
  }
}

declare module 'vitest' {
  interface ProvidedContext {
    databaseUrl: string
  }
}
