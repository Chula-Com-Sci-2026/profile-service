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
 * Without these a blackholed host — packets dropped rather than refused, which is what a
 * partition or a security-group change looks like — leaves `pool.query` neither resolving nor
 * rejecting until the OS gives up, about two minutes later. Measured. A probe that hangs is
 * worse than one that fails: the caller waits, and each attempt holds one of the ten slots.
 */
const CONNECT_BUDGET_MS = 2_000
const QUERY_BUDGET_MS = 2_000
const PING_BUDGET_MS = 2_500

/**
 * How long a ping answer is reused. `/ready` is unauthenticated, so without this every request
 * to it is a pool checkout and anyone can drain the pool out from under real traffic.
 */
const PING_CACHE_MS = 1_000

export function createDatabase(
  connectionString: string,
  onIdleError: (error: Error) => void,
): Database {
  const pool = new pg.Pool({
    connectionString,
    connectionTimeoutMillis: CONNECT_BUDGET_MS,
    query_timeout: QUERY_BUDGET_MS,
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
