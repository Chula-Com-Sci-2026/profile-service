import type { UnitOfWork } from './ports/unit-of-work.ts'

export type RepublishProfiles = () => Promise<number>

/**
 * Writes every profile's ProfileUpdated to the outbox again, each under the revision it already
 * has — domain.md §3 `republishProfiles()` — for a consumer whose copy must be rebuilt: Buddy
 * Discovery's consumer going live, its copy wiped, a bug in it (§1). Nothing changes, so no revision moves: a consumer holding a
 * card already takes the same card again, and one holding none takes every card.
 *
 * One unit of work, so the events are written all together or not at all. It sends nothing itself;
 * the running service's relay does. Answers how many it wrote.
 */
export function republishProfiles(unitOfWork: UnitOfWork): RepublishProfiles {
  return () =>
    unitOfWork.run(async ({ profiles, events }) => {
      const all = await profiles.findAll()
      for (const profile of all) await events.updated(profile)
      return all.length
    })
}
