import type { Profile } from './profile.ts'

/**
 * How the domain reaches storage. Declared here, implemented in `infrastructure/`.
 *
 * Reads report absence, writes raise conflicts: `findById` returns null and `update`
 * reports whether a row moved, because a missing profile is a normal result of a query.
 * `insert` is the exception — a unique violation is not a normal outcome of a write,
 * so it throws ProfileAlreadyExistsError.
 *
 * `insert` and `update` are separate so §5's one-profile-per-runner invariant is enforced
 * by the primary key rather than by a check-then-write race.
 *
 * An id that is not one (§4: a UUID in lowercase) matches nothing: `findById` answers null.
 */
export interface ProfileRepository {
  findById(id: string): Promise<Profile | null>
  insert(profile: Profile): Promise<void>
  update(profile: Profile): Promise<boolean>
}
