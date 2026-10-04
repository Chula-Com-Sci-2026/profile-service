import { describe, expect, it } from 'vitest'
import { deleteProfile } from '../../../src/application/delete-profile.ts'
import { ProfileNotFoundError } from '../../../src/domain/errors.ts'
import { FakeAvatarStorage } from './avatar-storage-double.ts'
import { InMemoryProfileRepository } from './in-memory-profile-repository.ts'
import { aProfile } from './profiles.ts'
import { RecordingProfileEvents, publishing } from './profile-events-double.ts'

describe('deleteProfile', () => {
  it('removes the runner\u2019s avatars too, without reading the profile to find them', async () => {
    const repository = new InMemoryProfileRepository()
    const storage = new FakeAvatarStorage()
    repository.given(aProfile())

    await deleteProfile(repository, storage, () => {}, publishing())('7f3a9c2e15')

    // Keys are prefixed by userId, so storage needs no help identifying what to drop.
    expect(storage.removed).toEqual(['7f3a9c2e15'])
  })

  it('still deletes the profile when storage fails, and reports the orphan', async () => {
    const repository = new InMemoryProfileRepository()
    const storage = new FakeAvatarStorage()
    storage.failOnRemove = true
    repository.given(aProfile())
    const orphans: string[] = []

    await deleteProfile(repository, storage, (userId) => orphans.push(userId), publishing())('7f3a9c2e15')

    expect(await repository.findById('7f3a9c2e15')).toBeNull()
    expect(orphans).toEqual(['7f3a9c2e15'])
  })

  it('leaves storage alone when there was no profile to delete', async () => {
    const storage = new FakeAvatarStorage()
    await expect(
      deleteProfile(new InMemoryProfileRepository(), storage, () => {}, publishing())('nobody'),
    ).rejects.toThrow(ProfileNotFoundError)
    expect(storage.removed).toEqual([])
  })

  it('removes the profile', async () => {
    const repository = new InMemoryProfileRepository()
    repository.given(aProfile())

    await deleteProfile(repository, new FakeAvatarStorage(), () => {}, publishing())('7f3a9c2e15')

    expect(await repository.findById('7f3a9c2e15')).toBeNull()
  })

  it('raises the domain error when there is nothing to remove', async () => {
    const repository = new InMemoryProfileRepository()

    await expect(deleteProfile(repository, new FakeAvatarStorage(), () => {}, publishing())('nobody')).rejects.toThrow(ProfileNotFoundError)
  })

  it('asks once, rather than reading and then deleting', async () => {
    let lookups = 0
    const repository = new InMemoryProfileRepository()
    repository.given(aProfile())
    const watched = {
      findById: async (userId: string) => {
        lookups += 1
        return repository.findById(userId)
      },
      insert: repository.insert.bind(repository),
      update: repository.update.bind(repository),
      delete: repository.delete.bind(repository),
    }

    await deleteProfile(watched, new FakeAvatarStorage(), () => {}, publishing())('7f3a9c2e15')
    expect(lookups).toBe(0)
  })
})

describe('deleteProfile — telling subscribers', () => {
  it('publishes ProfileDeleted once the profile is gone', async () => {
    const repository = new InMemoryProfileRepository()
    repository.given(aProfile())
    const events = new RecordingProfileEvents()

    await deleteProfile(repository, new FakeAvatarStorage(), () => {}, publishing(events))('7f3a9c2e15')

    expect(events.published).toEqual([{ type: 'deleted', userId: '7f3a9c2e15' }])
  })

  it('publishes nothing when there was nothing to delete', async () => {
    const events = new RecordingProfileEvents()

    await expect(
      deleteProfile(new InMemoryProfileRepository(), new FakeAvatarStorage(), () => {}, publishing(events))('nobody'),
    ).rejects.toThrow(ProfileNotFoundError)
    expect(events.published).toEqual([])
  })

  it('still deletes when delivery fails, and reports it', async () => {
    const repository = new InMemoryProfileRepository()
    repository.given(aProfile())
    const events = new RecordingProfileEvents()
    events.failWith = new Error('Buddy Discovery is down')
    const undelivered: string[] = []

    await deleteProfile(repository, new FakeAvatarStorage(), () => {}, {
      events,
      onUndelivered: (userId) => undelivered.push(userId),
    })('7f3a9c2e15')

    expect(await repository.findById('7f3a9c2e15')).toBeNull()
    expect(undelivered).toEqual(['7f3a9c2e15'])
  })
})
