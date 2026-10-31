import { describe, expect, it } from 'vitest'
import { getProfile } from '../../../src/application/get-profile.ts'
import { ProfileNotFoundError } from '../../../src/domain/errors.ts'
import { InMemoryProfileRepository } from './in-memory-profile-repository.ts'
import { aProfile, RAY } from './profiles.ts'

const NOBODY = '99999999-9999-4999-8999-999999999999'

describe('getProfile', () => {
  it('returns the whole profile', async () => {
    const repository = new InMemoryProfileRepository()
    repository.given(aProfile({ hiddenFields: ['bio'] }))

    const profile = await getProfile(repository)(RAY)
    expect(profile.name).toBe('Ray Attajak')
    expect(profile.bio).toBe('Evening runs, Lumphini.')
  })

  it('turns absence into a domain error, rather than returning null', async () => {
    await expect(getProfile(new InMemoryProfileRepository())(NOBODY)).rejects.toThrow(ProfileNotFoundError)
  })

  it('names the runner in the error', async () => {
    await expect(getProfile(new InMemoryProfileRepository())(NOBODY)).rejects.toMatchObject({ id: NOBODY })
  })
})
