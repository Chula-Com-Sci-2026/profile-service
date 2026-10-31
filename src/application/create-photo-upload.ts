import { ProfileNotFoundError } from '../domain/errors.ts'
import type { ProfileRepository } from '../domain/profile-repository.ts'
import { StorageUnavailableError } from './errors.ts'
import type { PhotoStorage, PhotoUpload } from './ports/photo-storage.ts'

export type CreatePhotoUpload = (id: string) => Promise<PhotoUpload>

/**
 * Authorises an upload — domain.md §3 `createPhotoUpload()`. It does not touch the profile.
 *
 * The runner attaches the key once the upload succeeds, so a failed upload leaves nothing pointing
 * at an object that does not exist. A runner with no profile gets no link: there would be nothing
 * to attach it to.
 */
export function createPhotoUpload(repository: ProfileRepository, storage: PhotoStorage): CreatePhotoUpload {
  return async (id) => {
    if ((await repository.findById(id)) === null) throw new ProfileNotFoundError(id)
    return storage.createUpload(id).catch((error: unknown) => {
      throw new StorageUnavailableError(error)
    })
  }
}
