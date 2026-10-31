import { describe, expect, it } from 'vitest'
import { removePhoto } from '../../../src/application/remove-photo.ts'
import { ProfileNotFoundError } from '../../../src/domain/errors.ts'
import { InMemoryProfileRepository } from './in-memory-profile-repository.ts'
import { InMemoryUnitOfWork } from './in-memory-unit-of-work.ts'
import { FakePhotoStorage, keyFor } from './photo-storage-double.ts'
import { aProfile, RAY } from './profiles.ts'

const PHOTO = keyFor(RAY)
const OTHER = keyFor(RAY, '9d3a7c5e-1b2f-4a6c-8e0d-3f5b7a9c1e2d')

function given(photoRef: string | null = PHOTO) {
  const repository = new InMemoryProfileRepository()
  repository.given(aProfile({ photoRef }))
  const unitOfWork = new InMemoryUnitOfWork(repository)
  const storage = new FakePhotoStorage()
  if (photoRef !== null) storage.objects.add(photoRef)
  const orphans: string[] = []
  const remove = removePhoto(unitOfWork, storage, (id) => orphans.push(id))
  return { repository, unitOfWork, storage, orphans, remove }
}

describe('removePhoto', () => {
  it('takes the photo off, publishes it, and removes the object after the write', async () => {
    const { repository, unitOfWork, storage, remove } = given()

    const removed = await remove(RAY)

    expect(removed.photoRef).toBeNull()
    expect((await repository.findById(RAY))?.photoRef).toBeNull()
    expect(unitOfWork.published).toEqual([removed])
    expect(storage.removedKeys).toEqual([PHOTO])
  })

  it('raises its revision, and publishes it in the same unit of work', async () => {
    const { unitOfWork, remove } = given()
    const removed = await remove(RAY)
    expect(removed.revision).toBe(2)
    expect([unitOfWork.published, unitOfWork.runs]).toEqual([[removed], 1])
  })

  it('answers with the profile when there was no photo, removing nothing', async () => {
    const { storage, remove } = given(null)
    expect((await remove(RAY)).photoRef).toBeNull()
    expect(storage.removedKeys).toEqual([])
  })

  it('removes the photo the change actually replaced when another change got in first', async () => {
    const { repository, storage, remove } = given()
    storage.objects.add(OTHER)
    repository.interfere(() => repository.given(aProfile({ photoRef: OTHER, revision: 2 })))

    const removed = await remove(RAY)

    expect(removed).toMatchObject({ photoRef: null, revision: 3 })
    expect(storage.removedKeys).toEqual([OTHER])
  })

  it.each(['unreachable', 'failOnRemove'] as const)(
    'still takes the photo off when storage is %s, and reports the orphan',
    async (failure) => {
      // Storage down costs only the object, never the change.
      const { repository, storage, orphans, remove } = given()
      storage[failure] = true

      await remove(RAY)

      expect((await repository.findById(RAY))?.photoRef).toBeNull()
      expect(orphans).toEqual([RAY])
    },
  )

  it('raises the domain error when there is no profile', async () => {
    const repository = new InMemoryProfileRepository()
    const remove = removePhoto(new InMemoryUnitOfWork(repository), new FakePhotoStorage(), () => {})
    await expect(remove(RAY)).rejects.toThrow(ProfileNotFoundError)
  })
})
