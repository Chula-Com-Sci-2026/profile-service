import { ProfileNotFoundError } from '../domain/errors.ts'
import type { HiddenField } from '../domain/hidden-field.ts'
import type { Profile } from '../domain/profile.ts'
import type { UnitOfWork } from './ports/unit-of-work.ts'
import { retrying } from './retrying.ts'

export type SetFieldVisibility = (id: string, hiddenFields: readonly HiddenField[]) => Promise<Profile>

/**
 * Replaces which fields other runners see — domain.md §3 `setFieldVisibility()`, the team's
 * operation by that name. Its own operation rather than part of a save, so a save can never reveal
 * a field. A change like any other: its revision rises, and its event is written with it.
 */
export function setFieldVisibility(unitOfWork: UnitOfWork): SetFieldVisibility {
  return (id, hiddenFields) =>
    retrying(unitOfWork, async ({ profiles, events }) => {
      const current = await profiles.findById(id)
      if (current === null) throw new ProfileNotFoundError(id)
      const changed = current.setFieldVisibility(hiddenFields)
      await profiles.update(changed)
      await events.updated(changed)
      return changed
    })
}
