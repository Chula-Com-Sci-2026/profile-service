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

  async findById(id: string): Promise<Profile | null> {
    return this.#profiles.get(id) ?? null
  }

  async insert(profile: Profile): Promise<void> {
    if (this.#profiles.has(profile.id)) throw new ProfileAlreadyExistsError(profile.id)
    this.#profiles.set(profile.id, profile)
  }

  async update(profile: Profile): Promise<boolean> {
    if (!this.#profiles.has(profile.id)) return false
    this.#profiles.set(profile.id, profile)
    return true
  }

  /** Test seam: put a profile in place without going through insert. */
  given(profile: Profile): void {
    this.#profiles.set(profile.id, profile)
  }

  get size(): number {
    return this.#profiles.size
  }
}
