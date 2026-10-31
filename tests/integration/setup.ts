import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { RabbitMQContainer, type StartedRabbitMQContainer } from '@testcontainers/rabbitmq'
import type { TestProject } from 'vitest/node'
import { MIGRATION_BUDGETS, createDatabase } from '../../src/infrastructure/database.ts'
import { applyMigrations } from '../../src/infrastructure/migrations.ts'

/**
 * The integration suite brings its own database and its own broker.
 *
 * `git clone && npm ci && npm run test:int` passes on a machine that has never seen this
 * project: no port to free, no database to create by hand, no second environment variable.
 * `docker-compose.yml` is untouched and still serves `npm run dev` and `db:seed`.
 *
 * Both image tags are also in `docker-compose.yml` — each pair must move together.
 */
const POSTGRES_IMAGE = 'postgres:16-alpine'
const RABBITMQ_IMAGE = 'rabbitmq:4.3.6-management'

/**
 * Profile's own broker user, with exactly the grant `docker-compose.yml` and the local-integration
 * snippet give it: configure and write on `cra.events`, read on nothing. Every sender test connects
 * as this user, so a sender that needed more would fail here first.
 */
const PROFILE_USER = { user: 'profile', password: 'profile' }
const GRANT = ['^cra\\.events$', '^cra\\.events$', '^$'] as const

/** The image's own login, which the tests use to bind queues and read them. */
const ADMIN = { user: 'guest', password: 'guest' }

export type RabbitMqAccess = {
  host: string
  port: number
  managementUrl: string
  admin: { user: string; password: string }
  profile: { user: string; password: string }
}

async function startRabbitMq(): Promise<StartedRabbitMQContainer> {
  const broker = await new RabbitMQContainer(RABBITMQ_IMAGE).start()
  for (const command of [
    ['rabbitmqctl', 'add_user', PROFILE_USER.user, PROFILE_USER.password],
    ['rabbitmqctl', 'set_permissions', '-p', '/', PROFILE_USER.user, ...GRANT],
  ]) {
    const result = await broker.exec(command)
    if (result.exitCode !== 0) throw new Error(`${command.join(' ')} failed: ${result.output}`)
  }
  return broker
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const started = await Promise.allSettled([new PostgreSqlContainer(POSTGRES_IMAGE).start(), startRabbitMq()])
  const [postgres, rabbitmq] = started
  const stop = async (): Promise<void> => {
    await Promise.all(started.map((result) => (result.status === 'fulfilled' ? result.value.stop() : undefined)))
  }

  try {
    if (postgres.status === 'rejected') throw postgres.reason
    if (rabbitmq.status === 'rejected') throw rabbitmq.reason
    const databaseUrl = postgres.value.getConnectionUri()

    // Migrate once, here — a suite that migrates per file races itself. Through the same
    // code and the same pool budgets the image uses, so the two cannot drift apart unnoticed.
    const database = createDatabase(databaseUrl, () => undefined, MIGRATION_BUDGETS)
    try {
      await applyMigrations(database)
    } finally {
      await database.end()
    }

    const broker = rabbitmq.value
    project.provide('databaseUrl', databaseUrl)
    project.provide('rabbitmq', {
      host: broker.getHost(),
      port: broker.getMappedPort(5672),
      managementUrl: `http://${broker.getHost()}:${broker.getMappedPort(15672)}`,
      admin: ADMIN,
      profile: PROFILE_USER,
    })
    return stop
  } catch (error) {
    // The teardown closure is only handed back on success, so stop the containers ourselves
    // rather than leaving them running for every failed start.
    await stop()
    throw error
  }
}

declare module 'vitest' {
  interface ProvidedContext {
    databaseUrl: string
    rabbitmq: RabbitMqAccess
  }
}
