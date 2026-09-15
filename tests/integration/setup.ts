import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'
import type { TestProject } from 'vitest/node'

/**
 * The integration suite brings its own database.
 *
 * `git clone && npm ci && npm run test:int` passes on a machine that has never seen this
 * project: no port to free, no database to create by hand, no second environment variable.
 * `docker-compose.yml` is untouched and still serves `npm run dev` and `db:seed`.
 *
 * The image tag is also in `docker-compose.yml` — the two must move together.
 */
const POSTGRES_IMAGE = 'postgres:17-alpine'

let container: StartedPostgreSqlContainer

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  container = await new PostgreSqlContainer(POSTGRES_IMAGE).start()
  const databaseUrl = container.getConnectionUri()

  // Migrate once, here — a suite that migrates per file races itself.
  const pool = new pg.Pool({ connectionString: databaseUrl })
  await migrate(drizzle(pool), { migrationsFolder: 'drizzle' })
  await pool.end()

  project.provide('databaseUrl', databaseUrl)

  return async () => {
    await container.stop()
  }
}

declare module 'vitest' {
  interface ProvidedContext {
    databaseUrl: string
  }
}
