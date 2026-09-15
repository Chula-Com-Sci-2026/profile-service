import { eq } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { ProfileAlreadyExistsError } from '../domain/errors.ts'
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
  let current: unknown = error
  while (current !== null && current !== undefined) {
    if ((current as { code?: unknown }).code === UNIQUE_VIOLATION) return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}

export class DrizzleProfileRepository implements ProfileRepository {
  readonly #db: NodePgDatabase

  constructor(db: NodePgDatabase) {
    this.#db = db
  }

  async findById(userId: string): Promise<Profile | null> {
    const rows = await this.#db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1)
    const row = rows[0]
    return row === undefined ? null : toDomain(row)
  }

  async insert(profile: Profile): Promise<void> {
    try {
      await this.#db.insert(profiles).values(toRow(profile))
    } catch (error) {
      if (isUniqueViolation(error)) throw new ProfileAlreadyExistsError(profile.userId)
      throw error
    }
  }

  async update(profile: Profile): Promise<boolean> {
    const result = await this.#db
      .update(profiles)
      .set(toRow(profile))
      .where(eq(profiles.userId, profile.userId))
    return (result.rowCount ?? 0) > 0
  }

  async delete(userId: string): Promise<boolean> {
    const result = await this.#db.delete(profiles).where(eq(profiles.userId, userId))
    return (result.rowCount ?? 0) > 0
  }
}
