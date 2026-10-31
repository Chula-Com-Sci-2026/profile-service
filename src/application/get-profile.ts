import { ProfileNotFoundError } from '../domain/errors.ts'
import type { Profile } from '../domain/profile.ts'
import type { ProfileRepository } from '../domain/profile-repository.ts'

export type GetProfile = (id: string) => Promise<Profile>

/**
 * The whole profile, for its owner — domain.md §3 `getProfile()`.
 *
 * The repository reports absence with null because that is a normal result of a query.
 * Deciding that absence is an error is policy, and policy lives here.
 */
export function getProfile(repository: ProfileRepository): GetProfile {
  return async (id) => {
    const profile = await repository.findById(id)
    if (profile === null) throw new ProfileNotFoundError(id)
    return profile
  }
}
