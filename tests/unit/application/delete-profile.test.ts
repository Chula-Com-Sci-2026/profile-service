import { describe, expect, it } from 'vitest'
import { deleteProfile } from '../../../src/application/delete-profile.ts'
import { ProfileNotFoundError } from '../../../src/domain/errors.ts'
import { InMemoryProfileRepository } from './in-memory-profile-repository.ts'
import { aProfile } from './profiles.ts'

describe('deleteProfile', () => {
  it('removes the profile', async () => {
    const repository = new InMemoryProfileRepository()
    repository.given(aProfile())

    await deleteProfile(repository)('7f3a9c2e15')

    expect(await repository.findById('7f3a9c2e15')).toBeNull()
  })

  it('raises the domain error when there is nothing to remove', async () => {
    const repository = new InMemoryProfileRepository()

    await expect(deleteProfile(repository)('nobody')).rejects.toThrow(ProfileNotFoundError)
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

    await deleteProfile(watched)('7f3a9c2e15')
    expect(lookups).toBe(0)
  })
})
