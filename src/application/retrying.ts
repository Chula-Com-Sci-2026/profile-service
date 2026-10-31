import { ConcurrentChangeError, ProfileAlreadyExistsError } from '../domain/errors.ts'
import type { Transaction, UnitOfWork } from './ports/unit-of-work.ts'

/** How many times a change is made before its conflict is reported. */
export const MAX_ATTEMPTS = 3

/**
 * Makes a change to a profile in a transaction of its own, and again in a new one when another
 * change got in first — domain.md §5. Either conflict counts: a first save that met the primary key,
 * or a write over a revision that has moved on. Every write is a replace, so making the change
 * again on what is there now is correct.
 *
 * Each attempt is a fresh `run`, never a retry inside the same one: a unique violation aborts the
 * transaction it happens in. After the last attempt the conflict is thrown as it is, and the edge
 * answers it as any failure it does not know — a logged 500.
 */
export async function retrying<T>(unitOfWork: UnitOfWork, work: (transaction: Transaction) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await unitOfWork.run(work)
    } catch (error) {
      const conflict = error instanceof ProfileAlreadyExistsError || error instanceof ConcurrentChangeError
      if (!conflict || attempt === MAX_ATTEMPTS) throw error
    }
  }
}
