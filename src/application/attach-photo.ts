import { InvalidProfileFieldError, ProfileNotFoundError } from '../domain/errors.ts'
import type { Profile } from '../domain/profile.ts'
import type { ProfileRepository } from '../domain/profile-repository.ts'
import { StorageUnavailableError } from './errors.ts'
import type { PhotoStorage } from './ports/photo-storage.ts'
import type { Publishing } from './publishing.ts'

export type AttachPhoto = (id: string, photoRef: string) => Promise<Profile>

/**
 * Puts an uploaded photo on the profile — domain.md §3 `attachPhoto()`.
 *
 * The key must be one of this runner's and the object must be there, or every viewer would see a
 * broken image — and a runner could adopt another's photo and later have it removed. §4's rule on
 * the key is checked first: it needs no network.
 *
 * A photo it replaces is unreachable from then on, since every upload mints a fresh key, so it is
 * removed — after the write and best effort: storage and the database cannot commit together, and
 * the change is the thing that must not be lost.
 */
export function attachPhoto(
  repository: ProfileRepository,
  storage: PhotoStorage,
  onOrphan: (id: string, error: unknown) => void,
  publishing: Publishing,
): AttachPhoto {
  return async (id, photoRef) => {
    const current = await repository.findById(id)
    if (current === null) throw new ProfileNotFoundError(id)
    const attached = current.attachPhoto(photoRef)

    const held = await storage.holds(id, photoRef).catch((error: unknown) => {
      throw new StorageUnavailableError(error)
    })
    if (!held) throw new InvalidProfileFieldError('photoRef', 'must name a photo uploaded for this runner')

    if (!(await repository.update(attached))) throw new ProfileNotFoundError(id)
    await publishing.events.updated(attached).catch((error: unknown) => publishing.onUndelivered(id, error))

    const displaced = current.photoRef
    if (displaced !== null && displaced !== attached.photoRef) {
      await storage.remove(id, displaced).catch((error: unknown) => onOrphan(id, error))
    }
    return attached
  }
}
