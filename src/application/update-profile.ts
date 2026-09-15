import { ProfileNotFoundError } from '../domain/errors.ts'
import type { Profile, ProfileChanges } from '../domain/profile.ts'
import type { ProfileRepository } from '../domain/profile-repository.ts'

export type UpdateProfile = (userId: string, changes: ProfileChanges) => Promise<Profile>

/**
 * Changes a profile — domain.md §3. `userId` never changes.
 *
 * The merge itself belongs to the aggregate: an absent field is left alone and an explicit
 * null clears it, and both are domain rules, so `profile.update()` decides them rather than
 * this layer. A partial-update semantic, not an HTTP one — the media type that expresses it
 * is the edge's business.
 */
export function updateProfile(repository: ProfileRepository): UpdateProfile {
  return async (userId, changes) => {
    const current = await repository.findById(userId)
    if (current === null) throw new ProfileNotFoundError(userId)

    const next = current.update(changes)
    // The profile could have been deleted between the read and the write.
    if (!(await repository.update(next))) throw new ProfileNotFoundError(userId)
    return next
  }
}
