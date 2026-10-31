import { ProfileAlreadyExistsError, ProfileNotFoundError } from '../domain/errors.ts'
import { Profile, type ProfileContent } from '../domain/profile.ts'
import type { ProfileRepository } from '../domain/profile-repository.ts'
import type { Publishing } from './publishing.ts'

export type SaveProfile = (id: string, content: ProfileContent) => Promise<Profile>

/**
 * Creates the runner's profile, or replaces it — domain.md §3 `saveProfile()`: the team's
 * `createProfile()` and `updateProfile()`, reached through one save. What a save keeps and what it
 * replaces are `Profile.save()`'s rules; this decides only whether it is the first.
 *
 * The first save still rests on the primary key, not on the read before it: two first saves at
 * once — a double-submitted form — both read "no profile", and the second insert meets the key.
 * That one then reads again and replaces what the other created, as a second save would, so both
 * answer with a profile.
 *
 * Subscribers hear of it only once it is stored, so a refused save publishes nothing. Delivery
 * failing is reported, never thrown: the profile is saved (ADR-0019).
 */
export function saveProfile(repository: ProfileRepository, publishing: Publishing): SaveProfile {
  const write = async (id: string, content: ProfileContent): Promise<Profile> => {
    const current = await repository.findById(id)
    if (current === null) {
      const created = Profile.create(id, content)
      await repository.insert(created)
      return created
    }
    const saved = current.save(content)
    // Nothing deletes a profile, so a read profile that has gone by the write is a broken store.
    if (!(await repository.update(saved))) throw new ProfileNotFoundError(id)
    return saved
  }

  return async (id, content) => {
    const saved = await write(id, content).catch((error: unknown) => {
      if (error instanceof ProfileAlreadyExistsError) return write(id, content)
      throw error
    })
    await publishing.events.updated(saved).catch((error: unknown) => publishing.onUndelivered(id, error))
    return saved
  }
}
