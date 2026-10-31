import { ProfileNotFoundError } from '../domain/errors.ts'
import type { Profile, ProfileChanges } from '../domain/profile.ts'
import type { ProfileRepository } from '../domain/profile-repository.ts'
import type { AvatarStorage } from './ports/avatar-storage.ts'
import type { Publishing } from './publishing.ts'

export type UpdateProfile = (userId: string, changes: ProfileChanges) => Promise<Profile>

/**
 * Changes a profile — domain.md §3. `userId` never changes.
 *
 * The merge itself belongs to the aggregate: an absent field is left alone and an explicit
 * null clears it, and both are domain rules, so `profile.update()` decides them rather than
 * this layer. A partial-update semantic, not an HTTP one — the media type that expresses it
 * is the edge's business.
 */
export function updateProfile(
  repository: ProfileRepository,
  storage: AvatarStorage,
  onOrphan: (userId: string, error: unknown) => void,
  publishing: Publishing,
): UpdateProfile {
  return async (userId, changes) => {
    const current = await repository.findById(userId)
    if (current === null) throw new ProfileNotFoundError(userId)

    const next = current.update(changes)
    // Covers one race only: the profile deleted between the read and the write. It does not
    // cover two concurrent changes — both read the same profile, both write every column, and
    // the later write reverts the earlier one. See "Concurrent updates to one profile" under
    // Deferred on purpose in build_plan.md.
    if (!(await repository.update(next))) throw new ProfileNotFoundError(userId)

    // Subscribers hear of the change once it is saved; a failed delivery is reported, not thrown.
    await publishing.events.updated(next).catch((error: unknown) => publishing.onUndelivered(userId, error))

    // An avatar the profile no longer points at — replaced or cleared — is unreachable, since
    // every upload mints a fresh key. Dropping it here is what stops a change leaving litter.
    // After the write and best-effort: storage and the database cannot commit together, and the
    // change is the thing that must not be lost.
    const displaced = current.avatarRef
    if (displaced !== undefined && displaced !== next.avatarRef) {
      await storage.remove(userId, displaced).catch((error: unknown) => onOrphan(userId, error))
    }

    return next
  }
}
