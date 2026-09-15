import { describe, expect, it } from 'vitest'
import { deleteProfile } from '../../../src/application/delete-profile.ts'
import { ProfileNotFoundError } from '../../../src/domain/errors.ts'
import { FakeAvatarStorage } from './avatar-storage-double.ts'
import { InMemoryProfileRepository } from './in-memory-profile-repository.ts'
import { aProfile } from './profiles.ts'

describe('deleteProfile', () => {
  it('removes the runner\u2019s avatars too, without reading the profile to find them', async () => {
    const repository = new InMemoryProfileRepository()
    const storage = new FakeAvatarStorage()
    repository.given(aProfile())

    await deleteProfile(repository, storage, () => {})('7f3a9c2e15')

    // Keys are prefixed by userId, so storage needs no help identifying what to drop.
    expect(storage.removed).toEqual(['7f3a9c2e15'])
  })

  it('still deletes the profile when storage fails, and reports the orphan', async () => {
    const repository = new InMemoryProfileRepository()
    const storage = new FakeAvatarStorage()
    storage.failOnRemove = true
    repository.given(aProfile())
    const orphans: string[] = []

    await deleteProfile(repository, storage, (userId) => orphans.push(userId))('7f3a9c2e15')

    expect(await repository.findById('7f3a9c2e15')).toBeNull()
    expect(orphans).toEqual(['7f3a9c2e15'])
  })

  it('leaves storage alone when there was no profile to delete', async () => {
    const storage = new FakeAvatarStorage()
    await expect(
      deleteProfile(new InMemoryProfileRepository(), storage, () => {})('nobody'),
    ).rejects.toThrow(ProfileNotFoundError)
    expect(storage.removed).toEqual([])
  })

  it('removes the profile', async () => {
    const repository = new InMemoryProfileRepository()
    repository.given(aProfile())

    await deleteProfile(repository, new FakeAvatarStorage(), () => {})('7f3a9c2e15')

    expect(await repository.findById('7f3a9c2e15')).toBeNull()
  })

  it('raises the domain error when there is nothing to remove', async () => {
    const repository = new InMemoryProfileRepository()

    await expect(deleteProfile(repository, new FakeAvatarStorage(), () => {})('nobody')).rejects.toThrow(ProfileNotFoundError)
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

    await deleteProfile(watched, new FakeAvatarStorage(), () => {})('7f3a9c2e15')
    expect(lookups).toBe(0)
  })
})
