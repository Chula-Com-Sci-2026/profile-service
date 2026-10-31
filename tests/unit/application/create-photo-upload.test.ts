import { describe, expect, it } from 'vitest'
import { createPhotoUpload } from '../../../src/application/create-photo-upload.ts'
import { StorageUnavailableError } from '../../../src/application/errors.ts'
import { ProfileNotFoundError } from '../../../src/domain/errors.ts'
import { InMemoryProfileRepository } from './in-memory-profile-repository.ts'
import { FakePhotoStorage, keyFor } from './photo-storage-double.ts'
import { aProfile, RAY } from './profiles.ts'

describe('createPhotoUpload', () => {
  it('returns a URL to upload to and the key it will occupy', async () => {
    const repository = new InMemoryProfileRepository()
    repository.given(aProfile())

    const upload = await createPhotoUpload(repository, new FakePhotoStorage())(RAY)

    expect(upload.photoRef).toBe(keyFor(RAY))
    expect(upload.uploadUrl).toContain('X-Amz-Signature')
    expect(upload.expiresInSeconds).toBeGreaterThan(0)
  })

  it('refuses before storage is asked when there is no profile to attach a photo to', async () => {
    const storage = new FakePhotoStorage()

    await expect(createPhotoUpload(new InMemoryProfileRepository(), storage)(RAY)).rejects.toThrow(ProfileNotFoundError)
    expect(storage.created).toEqual([])
  })

  it('says storage is unavailable, keeping what storage said, when it does not answer', async () => {
    const repository = new InMemoryProfileRepository()
    repository.given(aProfile())
    const storage = new FakePhotoStorage()
    storage.unreachable = true

    const error = await createPhotoUpload(repository, storage)(RAY).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(StorageUnavailableError)
    expect((error as Error).cause).toEqual(new Error('storage is unreachable'))
  })

  it('does not change the profile — attaching is attachPhoto’s job', async () => {
    const repository = new InMemoryProfileRepository()
    repository.given(aProfile())

    await createPhotoUpload(repository, new FakePhotoStorage())(RAY)

    expect((await repository.findById(RAY))?.photoRef).toBeNull()
  })
})
