import { ProfileNotFoundError } from '../domain/errors.ts'
import type { ProfileRepository } from '../domain/profile-repository.ts'
import type { AvatarStorage } from './ports/avatar-storage.ts'
import type { Publishing } from './publishing.ts'

export type DeleteProfile = (userId: string) => Promise<void>

/**
 * Removes a profile permanently — domain.md §3.
 *
 * One statement, no read first: `delete` reports whether a row went, which is all this needs
 * to know, and asking first would only add a window for the answer to change. That survives the
 * avatar: keys are prefixed by `userId`, so storage can drop a runner's images without anyone
 * reading the profile to find out what they were.
 *
 * The image goes after the profile, and only if the profile went. Storage failing is logged and
 * tolerated — the two cannot commit together, and an orphaned object is a better outcome than a
 * profile that refuses to die.
 */
export function deleteProfile(
  repository: ProfileRepository,
  storage: AvatarStorage,
  onOrphan: (userId: string, error: unknown) => void,
  publishing: Publishing,
): DeleteProfile {
  return async (userId) => {
    if (!(await repository.delete(userId))) throw new ProfileNotFoundError(userId)
    await publishing.events.deleted(userId).catch((error: unknown) => publishing.onUndelivered(userId, error))
    await storage.removeAll(userId).catch((error: unknown) => onOrphan(userId, error))
  }
}
