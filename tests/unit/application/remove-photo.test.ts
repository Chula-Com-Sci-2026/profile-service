import { describe, expect, it } from 'vitest'
import { removePhoto } from '../../../src/application/remove-photo.ts'
import { ProfileNotFoundError } from '../../../src/domain/errors.ts'
import { InMemoryProfileRepository } from './in-memory-profile-repository.ts'
import { FakePhotoStorage } from './photo-storage-double.ts'
import { RecordingProfileEvents, publishing } from './profile-events-double.ts'
import { aProfile, RAY } from './profiles.ts'

const PHOTO = `photos/${RAY}/abc`

function given(photoRef: string | null = PHOTO) {
  const repository = new InMemoryProfileRepository()
  repository.given(aProfile({ photoRef }))
  const storage = new FakePhotoStorage()
  if (photoRef !== null) storage.objects.add(photoRef)
  const events = new RecordingProfileEvents()
  const orphans: string[] = []
  const remove = removePhoto(repository, storage, (id) => orphans.push(id), publishing(events))
  return { repository, storage, events, orphans, remove }
}

describe('removePhoto', () => {
  it('takes the photo off, publishes it, and removes the object after the write', async () => {
    const { repository, storage, events, remove } = given()

    const removed = await remove(RAY)

    expect(removed.photoRef).toBeNull()
    expect((await repository.findById(RAY))?.photoRef).toBeNull()
    expect(events.published).toEqual([{ type: 'updated', profile: removed }])
    expect(storage.removedKeys).toEqual([PHOTO])
  })

  it('answers with the profile when there was no photo, removing nothing', async () => {
    const { storage, remove } = given(null)
    expect((await remove(RAY)).photoRef).toBeNull()
    expect(storage.removedKeys).toEqual([])
  })

  it.each(['unreachable', 'failOnRemove'] as const)(
    'still takes the photo off when storage is %s, and reports the orphan',
    async (failure) => {
      // Review Focus 4: storage down costs only the object, never the change.
      const { repository, storage, orphans, remove } = given()
      storage[failure] = true

      await remove(RAY)

      expect((await repository.findById(RAY))?.photoRef).toBeNull()
      expect(orphans).toEqual([RAY])
    },
  )

  it('raises the domain error when there is no profile', async () => {
    const remove = removePhoto(new InMemoryProfileRepository(), new FakePhotoStorage(), () => {}, publishing())
    await expect(remove(RAY)).rejects.toThrow(ProfileNotFoundError)
  })
})
