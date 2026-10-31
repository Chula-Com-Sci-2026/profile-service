import { describe, expect, it } from 'vitest'
import { getPublicProfile } from '../../../src/application/get-public-profile.ts'
import { ProfileNotFoundError } from '../../../src/domain/errors.ts'
import { InMemoryProfileRepository } from './in-memory-profile-repository.ts'
import { aProfile, RAY } from './profiles.ts'

const NOBODY = '99999999-9999-4999-8999-999999999999'

describe('getPublicProfile', () => {
  it('returns the public card, not the profile — hidden fields as null, no exact point', async () => {
    const repository = new InMemoryProfileRepository()
    repository.given(aProfile({ hiddenFields: ['bio', 'gear'] }))

    const card = await getPublicProfile(repository)(RAY)
    expect(card.name).toBe('Ray Attajak')
    expect(card.bio).toBeNull()
    expect(card.gear).toBeNull()
    expect('latitude' in card).toBe(false)
    expect('hiddenFields' in card).toBe(false)
  })

  it('raises the domain error, naming the runner, when there is none', async () => {
    await expect(getPublicProfile(new InMemoryProfileRepository())(NOBODY)).rejects.toThrow(ProfileNotFoundError)
    await expect(getPublicProfile(new InMemoryProfileRepository())(NOBODY)).rejects.toMatchObject({ id: NOBODY })
  })
})
