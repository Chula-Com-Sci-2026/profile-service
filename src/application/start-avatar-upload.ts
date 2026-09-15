import { ProfileNotFoundError } from '../domain/errors.ts'
import type { ProfileRepository } from '../domain/profile-repository.ts'
import type { AvatarStorage, AvatarUpload } from './ports/avatar-storage.ts'

export type StartAvatarUpload = (userId: string) => Promise<AvatarUpload>

/**
 * Authorises an upload. It does not touch the profile.
 *
 * The runner PATCHes `avatarRef` once the upload succeeds, so a failed upload leaves nothing
 * pointing at an object that does not exist — and setting a field stays `updateProfile`'s job
 * rather than becoming a second way to change the aggregate.
 */
export function startAvatarUpload(
  repository: ProfileRepository,
  storage: AvatarStorage,
): StartAvatarUpload {
  return async (userId) => {
    if ((await repository.findById(userId)) === null) throw new ProfileNotFoundError(userId)
    return storage.authoriseUpload(userId)
  }
}
