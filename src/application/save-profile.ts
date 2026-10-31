import { Profile, type ProfileContent } from '../domain/profile.ts'
import type { UnitOfWork } from './ports/unit-of-work.ts'
import { retrying } from './retrying.ts'

export type SaveProfile = (id: string, content: ProfileContent) => Promise<Profile>

/**
 * Creates the runner's profile, or replaces it — domain.md §3 `saveProfile()`: the team's
 * `createProfile()` and `updateProfile()`, reached through one save. What a save keeps and what it
 * replaces are `Profile.save()`'s rules; this decides only whether it is the first.
 *
 * Its event is written with it, in one transaction, so a refused save publishes nothing and a
 * stored one is never left untold. When another change gets in first — a double-submitted first
 * save, another tab, a profile gone since it was read — the save is made again on what is there
 * now, as `retrying` says; a profile that is gone makes it a first save.
 */
export function saveProfile(unitOfWork: UnitOfWork): SaveProfile {
  return (id, content) =>
    retrying(unitOfWork, async ({ profiles, events }) => {
      const current = await profiles.findById(id)
      const saved = current === null ? Profile.create(id, content) : current.save(content)
      if (current === null) await profiles.insert(saved)
      else await profiles.update(saved)
      await events.updated(saved)
      return saved
    })
}
