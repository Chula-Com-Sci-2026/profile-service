import { InvalidProfileFieldError, ProfileNotFoundError } from '../domain/errors.ts'
import type { Profile } from '../domain/profile.ts'
import type { ProfileRepository } from '../domain/profile-repository.ts'
import { StorageUnavailableError } from './errors.ts'
import type { PhotoStorage } from './ports/photo-storage.ts'
import type { UnitOfWork } from './ports/unit-of-work.ts'
import { retrying } from './retrying.ts'

export type AttachPhoto = (id: string, photoRef: string) => Promise<Profile>

/**
 * Puts an uploaded photo on the profile — domain.md §3 `attachPhoto()`.
 *
 * The key must be one of this runner's and the object must be there, or every viewer would see a
 * broken image — and a runner could adopt another's photo and later have it removed. §4's rule on
 * the key is checked first: it needs no network.
 *
 * Both checks come first, outside any transaction, so none is held open across a call to storage;
 * the change itself is then made — and made again, if another got in first — in one transaction
 * with its event.
 *
 * A photo it replaces is unreachable from then on, since every upload mints a fresh key, so it is
 * removed — after the commit and best effort: storage and the database cannot commit together, and
 * the change is the thing that must not be lost. The photo removed is the one the change actually
 * replaced, which another change may have put there since the first read.
 */
export function attachPhoto(
  repository: ProfileRepository,
  unitOfWork: UnitOfWork,
  storage: PhotoStorage,
  onOrphan: (id: string, error: unknown) => void,
): AttachPhoto {
  return async (id, photoRef) => {
    // Before the transaction, so none is ever held open across a call to storage.
    const before = await repository.findById(id)
    if (before === null) throw new ProfileNotFoundError(id)
    before.attachPhoto(photoRef)

    const held = await storage.holds(id, photoRef).catch((error: unknown) => {
      throw new StorageUnavailableError(error)
    })
    if (!held) throw new InvalidProfileFieldError('photoRef', 'must name a photo uploaded for this runner')

    const { attached, displaced } = await retrying(unitOfWork, async ({ profiles, events }) => {
      const current = await profiles.findById(id)
      if (current === null) throw new ProfileNotFoundError(id)
      const next = current.attachPhoto(photoRef)
      await profiles.update(next)
      await events.updated(next)
      return { attached: next, displaced: current.photoRef }
    })

    if (displaced !== null && displaced !== attached.photoRef) {
      await storage.remove(id, displaced).catch((error: unknown) => onOrphan(id, error))
    }
    return attached
  }
}
