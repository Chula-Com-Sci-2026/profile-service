import { Profile, type ProfileFields } from '../domain/profile.ts'
import type { ProfileRepository } from '../domain/profile-repository.ts'
import type { Publishing } from './publishing.ts'

export type CreateProfile = (fields: ProfileFields) => Promise<Profile>

/**
 * Creates a runner's profile — domain.md §3.
 *
 * No check-then-write: `insert` raises ProfileAlreadyExistsError from the primary key, so
 * §5's one-profile-per-runner holds even when two requests arrive at once. Looking first
 * and then inserting would leave a window between the two.
 *
 * Subscribers hear of it only after the insert succeeds, so a refused write publishes nothing.
 * Delivery failing is reported, never thrown: the profile is saved (ADR-0019).
 */
export function createProfile(repository: ProfileRepository, publishing: Publishing): CreateProfile {
  return async (fields) => {
    const profile = new Profile(fields)
    await repository.insert(profile)
    await publishing.events
      .updated(profile)
      .catch((error: unknown) => publishing.onUndelivered(profile.userId, error))
    return profile
  }
}
