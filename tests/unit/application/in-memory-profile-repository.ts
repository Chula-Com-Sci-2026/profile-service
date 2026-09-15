import { ProfileAlreadyExistsError } from '../../../src/domain/errors.ts'
import type { Profile } from '../../../src/domain/profile.ts'
import type { ProfileRepository } from '../../../src/domain/profile-repository.ts'

/**
 * A repository that keeps profiles in a Map.
 *
 * It honours the same contract as the Drizzle one — reads report absence, writes raise
 * conflicts — so a use case cannot tell them apart. That is the point of the interface.
 */
export class InMemoryProfileRepository implements ProfileRepository {
  readonly #profiles = new Map<string, Profile>()

  async findById(userId: string): Promise<Profile | null> {
    return this.#profiles.get(userId) ?? null
  }

  async insert(profile: Profile): Promise<void> {
    if (this.#profiles.has(profile.userId)) throw new ProfileAlreadyExistsError(profile.userId)
    this.#profiles.set(profile.userId, profile)
  }

  async update(profile: Profile): Promise<boolean> {
    if (!this.#profiles.has(profile.userId)) return false
    this.#profiles.set(profile.userId, profile)
    return true
  }

  async delete(userId: string): Promise<boolean> {
    return this.#profiles.delete(userId)
  }

  /** Test seam: put a profile in place without going through insert. */
  given(profile: Profile): void {
    this.#profiles.set(profile.userId, profile)
  }

  get size(): number {
    return this.#profiles.size
  }
}
