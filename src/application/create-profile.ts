import { Profile, type ProfileFields } from '../domain/profile.ts'
import type { ProfileRepository } from '../domain/profile-repository.ts'

export type CreateProfile = (fields: ProfileFields) => Promise<Profile>

/**
 * Creates a runner's profile — domain.md §3.
 *
 * No check-then-write: `insert` raises ProfileAlreadyExistsError from the primary key, so
 * §5's one-profile-per-runner holds even when two requests arrive at once. Looking first
 * and then inserting would leave a window between the two.
 */
export function createProfile(repository: ProfileRepository): CreateProfile {
  return async (fields) => {
    const profile = new Profile(fields)
    await repository.insert(profile)
    return profile
  }
}
