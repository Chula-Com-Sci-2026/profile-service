import { ProfileNotFoundError } from '../domain/errors.ts'
import type { HiddenField } from '../domain/hidden-field.ts'
import type { Profile } from '../domain/profile.ts'
import type { ProfileRepository } from '../domain/profile-repository.ts'
import type { Publishing } from './publishing.ts'

export type SetFieldVisibility = (id: string, hiddenFields: readonly HiddenField[]) => Promise<Profile>

/**
 * Replaces which fields other runners see — domain.md §3 `setFieldVisibility()`, the team's
 * operation by that name. Its own operation rather than part of a save, so a save can never reveal
 * a field. A change like any other: subscribers hear of it once it is stored.
 */
export function setFieldVisibility(repository: ProfileRepository, publishing: Publishing): SetFieldVisibility {
  return async (id, hiddenFields) => {
    const current = await repository.findById(id)
    if (current === null) throw new ProfileNotFoundError(id)

    const changed = current.setFieldVisibility(hiddenFields)
    if (!(await repository.update(changed))) throw new ProfileNotFoundError(id)

    await publishing.events.updated(changed).catch((error: unknown) => publishing.onUndelivered(id, error))
    return changed
  }
}
