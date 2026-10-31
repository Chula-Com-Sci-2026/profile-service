import { describe, expect, it } from 'vitest'
import { attachPhoto } from '../../../src/application/attach-photo.ts'
import { StorageUnavailableError } from '../../../src/application/errors.ts'
import { InvalidProfileFieldError, ProfileNotFoundError } from '../../../src/domain/errors.ts'
import { InMemoryProfileRepository } from './in-memory-profile-repository.ts'
import { FakePhotoStorage } from './photo-storage-double.ts'
import { RecordingProfileEvents, publishing } from './profile-events-double.ts'
import { aProfile, RAY } from './profiles.ts'

const BEAM = '44444444-4444-4444-8444-444444444444'
const NEW = `photos/${RAY}/new`
const OLD = `photos/${RAY}/old`

function given(photoRef: string | null = null) {
  const repository = new InMemoryProfileRepository()
  repository.given(aProfile({ photoRef }))
  const storage = new FakePhotoStorage()
  storage.objects.add(NEW)
  if (photoRef !== null) storage.objects.add(photoRef)
  const events = new RecordingProfileEvents()
  const orphans: string[] = []
  const attach = attachPhoto(repository, storage, (id) => orphans.push(id), publishing(events))
  return { repository, storage, events, orphans, attach }
}

describe('attachPhoto', () => {
  it('puts an uploaded photo on the profile, stores it and publishes it', async () => {
    const { repository, events, attach } = given()

    const attached = await attach(RAY, NEW)

    expect(attached.photoRef).toBe(NEW)
    expect((await repository.findById(RAY))?.photoRef).toBe(NEW)
    expect(events.published).toEqual([{ type: 'updated', profile: attached }])
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
    await expect(attach(RAY, `photos/${RAY}/missing`)).rejects.toThrow(expect.objectContaining({ field: 'photoRef' }))
  })

  it('refuses another runner’s key even when it exists, and deletes nothing of theirs', async () => {
    // Review Focus 5: a runner must never adopt — and later have removed — another runner's photo.
    const { repository, storage, events, attach } = given(OLD)
    const theirs = `photos/${BEAM}/abc`
    storage.objects.add(theirs)

    await expect(attach(RAY, theirs)).rejects.toThrow(InvalidProfileFieldError)
    expect(storage.removedKeys).toEqual([])
    expect(storage.objects.has(theirs)).toBe(true)
    expect(events.published).toEqual([])
    expect((await repository.findById(RAY))?.photoRef).toBe(OLD)
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
    const attach = attachPhoto(new InMemoryProfileRepository(), new FakePhotoStorage(), () => {}, publishing())
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
