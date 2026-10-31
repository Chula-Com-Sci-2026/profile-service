import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { UnitOfWork } from '../application/ports/unit-of-work.ts'
import { DrizzleProfileRepository } from './drizzle-profile-repository.ts'
import { outboxProfileEvents, type OutboxEventsOptions } from './outbox-profile-events.ts'

/**
 * The unit of work over PostgreSQL. Each `run` is a transaction of its own, holding a repository
 * and the outbox events on that transaction, so a change and its event commit together.
 *
 * Over the pool, each run takes its own connection and its own transaction. Over a transaction —
 * the seed's — each run is a savepoint, so a conflict rolls back that attempt alone and the next
 * one starts clean: a unique violation aborts whatever transaction it happens in.
 */
export function drizzleUnitOfWork(db: NodePgDatabase, options: OutboxEventsOptions): UnitOfWork {
  return {
    run: (work) =>
      db.transaction((tx) =>
        work({ profiles: new DrizzleProfileRepository(tx), events: outboxProfileEvents(tx, options) }),
      ),
  }
}
