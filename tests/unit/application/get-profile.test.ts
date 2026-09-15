import { describe, expect, it } from 'vitest'
import { getProfile } from '../../../src/application/get-profile.ts'
import { ProfileNotFoundError } from '../../../src/domain/errors.ts'
import { InMemoryProfileRepository } from './in-memory-profile-repository.ts'
import { aProfile } from './profiles.ts'

describe('getProfile', () => {
  it('returns the profile', async () => {
    const repository = new InMemoryProfileRepository()
    repository.given(aProfile())

    expect((await getProfile(repository)('7f3a9c2e15')).displayName).toBe('Nok')
  })

  it('turns absence into a domain error, rather than returning null', async () => {
    const repository = new InMemoryProfileRepository()

    await expect(getProfile(repository)('nobody')).rejects.toThrow(ProfileNotFoundError)
  })

  it('names the runner in the error', async () => {
    const repository = new InMemoryProfileRepository()

    await expect(getProfile(repository)('nobody')).rejects.toMatchObject({ userId: 'nobody' })
  })
})
