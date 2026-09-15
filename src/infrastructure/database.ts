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
  /**
   * Can we reach the database right now? Never throws — a probe wants an answer, not an error.
   *
   * It lives here so the composition root does not have to import `sql` from drizzle to ask,
   * which would put the ORM outside `infrastructure/` in the one file lint cannot check.
   */
  ping: () => Promise<boolean>
  /** Closes idle connections and waits for busy ones. Part of a clean shutdown. */
  end: () => Promise<void>
}

/**
 * `onIdleError` is not optional, and not a nicety.
 *
 * A pooled connection sitting idle can fail on its own — Postgres restarts, a proxy drops it,
 * a keepalive reaper collects it — and `pg.Pool` reports that by emitting `error`. `Pool` is an
 * EventEmitter, so an `error` event with no listener is rethrown as an uncaught exception and
 * takes the process with it, with no request in flight and a pool that would have reconnected
 * on the next checkout. A callback rather than a logger keeps `pino` out of this layer.
 */
export function createDatabase(
  connectionString: string,
  onIdleError: (error: Error) => void,
): Database {
  const pool = new pg.Pool({ connectionString })
  pool.on('error', onIdleError)

  return {
    db: drizzle(pool),
    ping: async () => {
      try {
        await pool.query('SELECT 1')
        return true
      } catch {
        return false
      }
    },
    end: () => pool.end(),
  }
}
