import { ProfileNotFoundError } from '../domain/errors.ts'
import type { ProfileRepository } from '../domain/profile-repository.ts'

export type DeleteProfile = (userId: string) => Promise<void>

/**
 * Removes a profile permanently — domain.md §3.
 *
 * One statement, no read first: `delete` reports whether a row went, which is all this
 * needs to know, and asking first would only add a window for the answer to change.
 */
export function deleteProfile(repository: ProfileRepository): DeleteProfile {
  return async (userId) => {
    if (!(await repository.delete(userId))) throw new ProfileNotFoundError(userId)
  }
}
