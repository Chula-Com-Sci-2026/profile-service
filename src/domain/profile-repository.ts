import type { Profile } from './profile.ts'

/**
 * How the domain reaches storage. Declared here, implemented in `infrastructure/`.
 *
 * Reads report absence, writes raise conflicts: `findById` returns null, because a missing
 * profile is a normal result of a query. The two writes enforce §5's two invariants and raise
 * when one would break:
 *
 * - `insert` throws ProfileAlreadyExistsError — one profile per runner, held by the primary key
 *   rather than by a check-then-write race.
 * - `update` writes a change only over the revision it was made from, the one before its own, and
 *   throws ConcurrentChangeError when the stored revision is another or there is no row at all.
 *
 * `findAll` is every profile, ordered by id — for sending every profile's event again.
 *
 * An id that is not one (§4: a UUID in lowercase) matches nothing: `findById` answers null.
 */
export interface ProfileRepository {
  findById(id: string): Promise<Profile | null>
  findAll(): Promise<readonly Profile[]>
  insert(profile: Profile): Promise<void>
  update(profile: Profile): Promise<void>
}
