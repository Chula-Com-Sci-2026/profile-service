import { ProfileNotFoundError } from '../domain/errors.ts'
import type { Profile } from '../domain/profile.ts'
import type { ProfileRepository } from '../domain/profile-repository.ts'

export type GetProfile = (userId: string) => Promise<Profile>

/**
 * Returns one profile, by id — domain.md §3. There is no way to list or search.
 *
 * The repository reports absence with null because that is a normal result of a query.
 * Deciding that absence is an error is policy, and policy lives here.
 */
export function getProfile(repository: ProfileRepository): GetProfile {
  return async (userId) => {
    const profile = await repository.findById(userId)
    if (profile === null) throw new ProfileNotFoundError(userId)
    return profile
  }
}
