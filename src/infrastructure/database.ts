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
  /** Closes idle connections and waits for busy ones. Part of a clean shutdown. */
  end: () => Promise<void>
}

export function createDatabase(connectionString: string): Database {
  const pool = new pg.Pool({ connectionString })
  return { db: drizzle(pool), end: () => pool.end() }
}
