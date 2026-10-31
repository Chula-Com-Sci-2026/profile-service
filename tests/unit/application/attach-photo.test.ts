import { describe, expect, it } from 'vitest'
import { attachPhoto } from '../../../src/application/attach-photo.ts'
import { StorageUnavailableError } from '../../../src/application/errors.ts'
import { InvalidProfileFieldError, ProfileNotFoundError } from '../../../src/domain/errors.ts'
import { InMemoryProfileRepository } from './in-memory-profile-repository.ts'
import { InMemoryUnitOfWork } from './in-memory-unit-of-work.ts'
import { FakePhotoStorage, keyFor } from './photo-storage-double.ts'
import { aProfile, RAY } from './profiles.ts'

const BEAM = '44444444-4444-4444-8444-444444444444'
const NEW = keyFor(RAY, '9d3a7c5e-1b2f-4a6c-8e0d-3f5b7a9c1e2d')
const OLD = keyFor(RAY, 'c6f4de83-2b48-4593-a003-42cc94afa15f')
const OTHER = keyFor(RAY, '2e4a6c8e-0b1d-4f3a-9c5e-7d9b1f3a5c7e')

function given(photoRef: string | null = null) {
  const repository = new InMemoryProfileRepository()
  repository.given(aProfile({ photoRef }))
  const storage = new FakePhotoStorage()
  storage.objects.add(NEW)
  if (photoRef !== null) storage.objects.add(photoRef)
  const unitOfWork = new InMemoryUnitOfWork(repository)
  const orphans: string[] = []
  const attach = attachPhoto(repository, unitOfWork, storage, (id) => orphans.push(id))
  return { repository, storage, unitOfWork, orphans, attach }
}

describe('attachPhoto', () => {
  it('puts an uploaded photo on the profile, stores it and publishes it', async () => {
    const { repository, unitOfWork, attach } = given()

    const attached = await attach(RAY, NEW)

    expect(attached.photoRef).toBe(NEW)
    expect((await repository.findById(RAY))?.photoRef).toBe(NEW)
    expect(unitOfWork.published).toEqual([attached])
  })

  it('raises its revision, and publishes it in the same unit of work', async () => {
    const { unitOfWork, attach } = given()
    const attached = await attach(RAY, NEW)
    expect(attached.revision).toBe(2)
    expect([unitOfWork.published, unitOfWork.runs]).toEqual([[attached], 1])
  })

  it('removes the photo the change actually replaced when another change got in first', async () => {
    const { repository, storage, attach } = given(OLD)
    storage.objects.add(OTHER)
    repository.interfere(() => repository.given(aProfile({ photoRef: OTHER, revision: 2 })))

    const attached = await attach(RAY, NEW)

    expect(attached).toMatchObject({ photoRef: NEW, revision: 3 })
    expect(storage.removedKeys).toEqual([OTHER])
  })

  it('asks storage once, however many attempts the write takes', async () => {
    const { repository, storage, unitOfWork, attach } = given()
    repository.interfere(() => repository.given(aProfile({ revision: 2 })))

    await attach(RAY, NEW)

    expect(unitOfWork.runs).toBe(2)
    expect(storage.asked).toEqual([NEW])
  })

  it('removes the photo it replaces, after the write', async () => {
    const { storage, attach } = given(OLD)
    await attach(RAY, NEW)
    expect(storage.removedKeys).toEqual([OLD])
  })

  it('removes nothing when the same photo is attached again', async () => {
    const { storage, attach } = given(NEW)
    await attach(RAY, NEW)
    expect(storage.removedKeys).toEqual([])
  })

  it('refuses a key that was never uploaded, on photoRef', async () => {
    const { attach } = given()
    await expect(attach(RAY, keyFor(RAY, '743e3a4e-7d97-431d-9fdf-bf7df238ee34'))).rejects.toThrow(expect.objectContaining({ field: 'photoRef' }))
  })

  it('refuses another runner’s key even when it exists, and deletes nothing of theirs', async () => {
    // Review Focus 5: a runner must never adopt — and later have removed — another runner's photo.
    const { repository, storage, unitOfWork, attach } = given(OLD)
    const theirs = keyFor(BEAM)
    storage.objects.add(theirs)

    await expect(attach(RAY, theirs)).rejects.toThrow(InvalidProfileFieldError)
    expect(storage.removedKeys).toEqual([])
    expect(storage.objects.has(theirs)).toBe(true)
    expect(unitOfWork.published).toEqual([])
    expect((await repository.findById(RAY))?.photoRef).toBe(OLD)
  })

  it.each([
    ['another runner’s real key', keyFor(BEAM)],
    ['a key whose dot segment climbs into another runner’s folder', `photos/${RAY}/../${BEAM}/0b5f3c1e-7d2a-4e9b-8f61-2c4d6e8a0b1c`],
  ])('refuses %s on photoRef without asking storage — a 422, never a 503', async (_, key) => {
    const { storage, attach } = given()
    storage.objects.add(key)
    storage.unreachable = true // asking would answer 503; refusing the key answers first
    await expect(attach(RAY, key)).rejects.toThrow(expect.objectContaining({ field: 'photoRef' }))
  })

  it('refuses a key over 128 characters before asking storage', async () => {
    const { storage, attach } = given()
    storage.unreachable = true // asking would answer 503; the rule answers first
    await expect(attach(RAY, `photos/${RAY}/${'x'.repeat(120)}`)).rejects.toThrow(InvalidProfileFieldError)
  })

  it('says storage is unavailable when it cannot be asked', async () => {
    const { storage, attach } = given()
    storage.unreachable = true
    await expect(attach(RAY, NEW)).rejects.toThrow(StorageUnavailableError)
  })

  it('raises the domain error when there is no profile', async () => {
    const repository = new InMemoryProfileRepository()
    const attach = attachPhoto(repository, new InMemoryUnitOfWork(repository), new FakePhotoStorage(), () => {})
    await expect(attach(RAY, NEW)).rejects.toThrow(ProfileNotFoundError)
  })

  it('keeps the new photo when storage fails to remove the old one, and reports the orphan', async () => {
    const { repository, storage, orphans, attach } = given(OLD)
    storage.failOnRemove = true

    await attach(RAY, NEW)

    expect((await repository.findById(RAY))?.photoRef).toBe(NEW)
    expect(orphans).toEqual([RAY])
  })
})
