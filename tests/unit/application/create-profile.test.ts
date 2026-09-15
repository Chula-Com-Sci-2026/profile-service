import { describe, expect, it } from 'vitest'
import { createProfile } from '../../../src/application/create-profile.ts'
import { InvalidProfileFieldError, ProfileAlreadyExistsError } from '../../../src/domain/errors.ts'
import type { ProfileRepository } from '../../../src/domain/profile-repository.ts'
import { InMemoryProfileRepository } from './in-memory-profile-repository.ts'
import { fieldsFor } from './profiles.ts'

describe('createProfile', () => {
  it('stores the profile and hands it back', async () => {
    const repository = new InMemoryProfileRepository()
    const profile = await createProfile(repository)(fieldsFor())

    expect(profile.userId).toBe('7f3a9c2e15')
    expect(await repository.findById('7f3a9c2e15')).toBe(profile)
  })

  it('raises the domain error when a runner already has one', async () => {
    const repository = new InMemoryProfileRepository()
    await createProfile(repository)(fieldsFor())

    await expect(createProfile(repository)(fieldsFor())).rejects.toThrow(ProfileAlreadyExistsError)
    expect(repository.size).toBe(1)
  })

  it('lets the write decide, rather than looking first', async () => {
    // A check-then-insert leaves a window between the two. Only insert is consulted, so
    // §5's one-profile-per-runner rests on the primary key.
    let lookups = 0
    const repository: ProfileRepository = {
      findById: async () => {
        lookups += 1
        return null
      },
      insert: async () => {},
      update: async () => true,
      delete: async () => true,
    }

    await createProfile(repository)(fieldsFor())
    expect(lookups).toBe(0)
  })

  it('refuses fields that break a §4 rule, before anything is stored', async () => {
    const repository = new InMemoryProfileRepository()

    await expect(createProfile(repository)(fieldsFor({ displayName: '  ' }))).rejects.toThrow(
      InvalidProfileFieldError,
    )
    expect(repository.size).toBe(0)
  })
})
