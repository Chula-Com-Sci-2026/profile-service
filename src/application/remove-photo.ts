import { ProfileNotFoundError } from '../domain/errors.ts'
import type { Profile } from '../domain/profile.ts'
import type { ProfileRepository } from '../domain/profile-repository.ts'
import type { PhotoStorage } from './ports/photo-storage.ts'
import type { Publishing } from './publishing.ts'

export type RemovePhoto = (id: string) => Promise<Profile>

/**
 * Takes the photo off the profile — domain.md §3 `removePhoto()` — then removes the object, after
 * the write and best effort. So storage being down never stops it: the photo comes off the profile,
 * and an object storage would not delete is logged as an orphan.
 */
export function removePhoto(
  repository: ProfileRepository,
  storage: PhotoStorage,
  onOrphan: (id: string, error: unknown) => void,
  publishing: Publishing,
): RemovePhoto {
  return async (id) => {
    const current = await repository.findById(id)
    if (current === null) throw new ProfileNotFoundError(id)

    const removed = current.removePhoto()
    if (!(await repository.update(removed))) throw new ProfileNotFoundError(id)
    await publishing.events.updated(removed).catch((error: unknown) => publishing.onUndelivered(id, error))

    if (current.photoRef !== null) {
      await storage.remove(id, current.photoRef).catch((error: unknown) => onOrphan(id, error))
    }
    return removed
  }
}
