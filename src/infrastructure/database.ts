import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import pg from 'pg'

/**
 * The database client. `pg` and `drizzle-orm` stay behind this boundary.
 *
 * The composition root is exempt from the import zones, so it *could* build a pool itself —
 * this exists so it does not have to, and "the ORM appears in infrastructure and nowhere else"
 * stays true in the one file lint cannot check.
 */
export type Database = {
  db: NodePgDatabase
  /** Can we reach the database right now? Answers within `PING_BUDGET_MS`, always. */
  ping: () => Promise<boolean>
  /** Closes idle connections and waits for busy ones. Part of a clean shutdown. */
  end: () => Promise<void>
}

/**
 * Budgets differ by what the pool is for, and getting that wrong is easy to miss.
 *
 * Without any, a blackholed host — packets dropped rather than refused, which is what a
 * partition or a security-group change looks like — leaves `pool.query` neither resolving nor
 * rejecting until the OS gives up, about two minutes later. Measured. A probe that hangs is
 * worse than one that fails.
 *
 * But the budget that saves the request path kills a migration: a two-second query limit
 * aborts any `CREATE INDEX` on real data, and with compose gating the service on the migration
 * completing, the whole stack then refuses to start. Also measured.
 */
const PING_BUDGET_MS = 2_500

export type Budgets = {
  connectMs: number
  /** `undefined` means no client-side limit. */
  queryMs: number | undefined
}

/** Serving a request. A query that takes two seconds here has already failed the caller. */
export const REQUEST_BUDGETS: Budgets = { connectMs: 2_000, queryMs: 2_000 }

/**
 * Applying migrations. A migration may legitimately take minutes — `CREATE INDEX` on a
 * populated table, a backfill, an `ALTER TABLE` that rewrites rows — so there is no query
 * limit, and a slower connect is tolerated because nothing is waiting on a response.
 */
export const MIGRATION_BUDGETS: Budgets = { connectMs: 10_000, queryMs: undefined }

/**
 * How long a ping answer is reused. `/ready` is unauthenticated, so without this every request
 * to it is a pool checkout and anyone can drain the pool out from under real traffic.
 */
const PING_CACHE_MS = 1_000

export function createDatabase(
  connectionString: string,
  onIdleError: (error: Error) => void,
  budgets: Budgets = REQUEST_BUDGETS,
): Database {
  const pool = new pg.Pool({
    connectionString,
    connectionTimeoutMillis: budgets.connectMs,
    ...(budgets.queryMs !== undefined && { query_timeout: budgets.queryMs }),
  })
  pool.on('error', onIdleError)

  let answeredAt = 0
  let answer = false
  let asking: Promise<boolean> | undefined

  const ask = async (): Promise<boolean> => {
    try {
      // Belt and braces: the pool's own budgets should fire first, but a probe must answer.
      await Promise.race([
        pool.query('SELECT 1'),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('ping budget exhausted')), PING_BUDGET_MS).unref(),
        ),
      ])
      return true
    } catch {
      return false
    }
  }

  return {
    db: drizzle(pool),
    ping: async () => {
      if (Date.now() - answeredAt < PING_CACHE_MS) return answer
      // One question at a time: concurrent probes share an answer rather than a slot each.
      asking ??= ask().then((ok) => {
        answer = ok
        answeredAt = Date.now()
        asking = undefined
        return ok
      })
      return asking
    },
    end: () => pool.end(),
  }
}
