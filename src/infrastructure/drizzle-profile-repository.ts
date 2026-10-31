import { eq } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { ProfileAlreadyExistsError } from '../domain/errors.ts'
import { isId } from '../domain/id.ts'
import type { Profile } from '../domain/profile.ts'
import type { ProfileRepository } from '../domain/profile-repository.ts'
import { toDomain, toRow } from './profile-mapper.ts'
import { profiles } from './schema.ts'

/** Postgres `unique_violation`. The primary key is what enforces §5's one-profile-per-runner. */
const UNIQUE_VIOLATION = '23505'

/**
 * Drivers and query builders wrap their errors, and how deeply is their business, not ours —
 * so walk the cause chain for the SQLSTATE rather than assuming which layer carries it.
 */
function isUniqueViolation(error: unknown): boolean {
  const seen = new Set<unknown>()
  let current: unknown = error
  while (current !== null && current !== undefined && !seen.has(current)) {
    seen.add(current)
    if ((current as { code?: unknown }).code === UNIQUE_VIOLATION) return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}

/** The innermost error in a cause chain: the driver's own report, beneath every wrapper. */
function rootCause(error: unknown): unknown {
  const seen = new Set<unknown>()
  let current = error
  while (!seen.has(current)) {
    seen.add(current)
    const next = (current as { cause?: unknown } | null)?.cause
    if (next === null || next === undefined) return current
    current = next
  }
  return current
}

/**
 * A write the database refused, with the row it was carrying left out.
 *
 * drizzle puts a failed query's parameters in its error's message, stack and `params`, and
 * Postgres's own `detail` can echo the failing row — so the error handler's log line would carry
 * the runner's exact point, which domain.md keeps inside this service. This keeps what diagnoses
 * the failure — the statement, the driver's message and its SQLSTATE — and drops the values.
 */
export class ProfileWriteFailedError extends Error {
  readonly query: string
  readonly code: string | undefined

  constructor(error: unknown) {
    const root = rootCause(error)
    const reason = root instanceof Error ? root.message : String(root)
    const code = (root as { code?: unknown } | null)?.code
    super(`could not write the profile: ${reason}`)
    this.name = 'ProfileWriteFailedError'
    this.query = String((error as { query?: unknown } | null)?.query ?? '')
    this.code = typeof code === 'string' ? code : undefined
  }
}

export class DrizzleProfileRepository implements ProfileRepository {
  readonly #db: NodePgDatabase

  constructor(db: NodePgDatabase) {
    this.#db = db
  }

  async findById(id: string): Promise<Profile | null> {
    // The column is `uuid`, which raises on anything that is not one. A value that is not an id
    // names no runner, so it matches nothing — the question never reaches the database.
    if (!isId(id)) return null
    const rows = await this.#db.select().from(profiles).where(eq(profiles.id, id)).limit(1)
    const row = rows[0]
    return row === undefined ? null : toDomain(row)
  }

  async insert(profile: Profile): Promise<void> {
    try {
      await this.#db.insert(profiles).values(toRow(profile))
    } catch (error) {
      if (isUniqueViolation(error)) throw new ProfileAlreadyExistsError(profile.id)
      throw new ProfileWriteFailedError(error)
    }
  }

  async update(profile: Profile): Promise<boolean> {
    try {
      const result = await this.#db
        .update(profiles)
        .set(toRow(profile))
        .where(eq(profiles.id, profile.id))
      return (result.rowCount ?? 0) > 0
    } catch (error) {
      throw new ProfileWriteFailedError(error)
    }
  }
}
