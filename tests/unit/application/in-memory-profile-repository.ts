import { ConcurrentChangeError, ProfileAlreadyExistsError } from '../../../src/domain/errors.ts'
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
  readonly #interferences: (() => void)[] = []

  async findById(id: string): Promise<Profile | null> {
    return this.#profiles.get(id) ?? null
  }

  async findAll(): Promise<readonly Profile[]> {
    return [...this.#profiles.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  }

  async insert(profile: Profile): Promise<void> {
    this.#interfere()
    if (this.#profiles.has(profile.id)) throw new ProfileAlreadyExistsError(profile.id)
    this.#profiles.set(profile.id, profile)
  }

  /** Written only over the revision the change was made from, as the Drizzle one does (§5). */
  async update(profile: Profile): Promise<void> {
    this.#interfere()
    if (this.#profiles.get(profile.id)?.revision !== profile.revision - 1) throw new ConcurrentChangeError(profile.id)
    this.#profiles.set(profile.id, profile)
  }

  /** Test seam: put a profile in place without going through insert. */
  given(profile: Profile): void {
    this.#profiles.set(profile.id, profile)
  }

  /** Test seam: the profile is gone, as if deleted by hand. */
  remove(id: string): void {
    this.#profiles.delete(id)
  }

  /**
   * Test seam: another request gets in first. `change` runs just before each of the next `times`
   * writes is checked — between this request's read and its write.
   */
  interfere(change: () => void, times = 1): void {
    for (let i = 0; i < times; i += 1) this.#interferences.push(change)
  }

  #interfere(): void {
    this.#interferences.shift()?.()
  }

  get size(): number {
    return this.#profiles.size
  }
}
