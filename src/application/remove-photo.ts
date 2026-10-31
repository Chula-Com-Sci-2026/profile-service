import { ProfileNotFoundError } from '../domain/errors.ts'
import type { Profile } from '../domain/profile.ts'
import type { PhotoStorage } from './ports/photo-storage.ts'
import type { UnitOfWork } from './ports/unit-of-work.ts'
import { retrying } from './retrying.ts'

export type RemovePhoto = (id: string) => Promise<Profile>

/**
 * Takes the photo off the profile — domain.md §3 `removePhoto()`, in one transaction with its
 * event — then removes the object, after the commit and best effort. So storage being down never
 * stops it: the photo comes off the profile, and an object storage would not delete is logged as an
 * orphan. The object removed is the one the change actually took off.
 */
export function removePhoto(
  unitOfWork: UnitOfWork,
  storage: PhotoStorage,
  onOrphan: (id: string, error: unknown) => void,
): RemovePhoto {
  return async (id) => {
    const { removed, displaced } = await retrying(unitOfWork, async ({ profiles, events }) => {
      const current = await profiles.findById(id)
      if (current === null) throw new ProfileNotFoundError(id)
      const next = current.removePhoto()
      await profiles.update(next)
      await events.updated(next)
      return { removed: next, displaced: current.photoRef }
    })

    if (displaced !== null) {
      await storage.remove(id, displaced).catch((error: unknown) => onOrphan(id, error))
    }
    return removed
  }
}
