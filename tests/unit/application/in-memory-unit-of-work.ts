import type { ProfileEvents } from '../../../src/application/ports/profile-events.ts'
import type { Transaction, UnitOfWork } from '../../../src/application/ports/unit-of-work.ts'
import type { Profile } from '../../../src/domain/profile.ts'
import type { InMemoryProfileRepository } from './in-memory-profile-repository.ts'

/**
 * A unit of work over an in-memory repository.
 *
 * The events a run writes are kept aside and land in `published` only when the run resolves, so a
 * run that throws — a conflict the use case retries, a rule broken — publishes nothing, as a rolled
 * back transaction would. Writes to the repository need no such care: the repository raises its
 * conflicts before it changes anything.
 */
export class InMemoryUnitOfWork implements UnitOfWork {
  /** The events of the runs that completed, in the order they were written. */
  readonly published: Profile[] = []
  /** How many runs were started — one per attempt. */
  runs = 0
  readonly #profiles: InMemoryProfileRepository

  constructor(profiles: InMemoryProfileRepository) {
    this.#profiles = profiles
  }

  async run<T>(work: (transaction: Transaction) => Promise<T>): Promise<T> {
    this.runs += 1
    const staged: Profile[] = []
    const events: ProfileEvents = {
      updated: async (profile) => {
        staged.push(profile)
      },
    }
    const result = await work({ profiles: this.#profiles, events })
    this.published.push(...staged)
    return result
  }
}
