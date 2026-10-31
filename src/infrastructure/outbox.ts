import { asc, eq, isNull, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { ProfileUpdatedEvent } from './profile-published-language.ts'
import { outbox } from './schema.ts'

/** One event waiting to go, and its place in the order they go in. */
export type OutboxMessage = { sequence: number; event: ProfileUpdatedEvent }

/** The outbox as the relay sees it: the next event to send, and a way to say it went. */
export type Outbox = {
  /** The oldest event not yet sent, or null when every one has gone. */
  oldestUnsent: () => Promise<OutboxMessage | null>
  /** Records that the broker has it. The row stays, with the time. */
  markSent: (sequence: number) => Promise<void>
}

export function drizzleOutbox(db: NodePgDatabase): Outbox {
  return {
    oldestUnsent: async () => {
      const rows = await db
        .select({ sequence: outbox.sequence, event: outbox.payload })
        .from(outbox)
        .where(isNull(outbox.publishedAt))
        .orderBy(asc(outbox.sequence))
        .limit(1)
      return rows[0] ?? null
    },
    markSent: async (sequence) => {
      await db.update(outbox).set({ publishedAt: sql`now()` }).where(eq(outbox.sequence, sequence))
    },
  }
}
