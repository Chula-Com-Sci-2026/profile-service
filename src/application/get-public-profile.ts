import type { ProfileRepository } from '../domain/profile-repository.ts'
import type { PublicCard } from '../domain/public-card.ts'
import { getProfile } from './get-profile.ts'

export type GetPublicProfile = (id: string) => Promise<PublicCard>

/**
 * A runner's public card — domain.md §3 `getPublicProfile()`, for anyone, its owner included.
 *
 * It answers the card, never the profile, so whatever serialises the answer cannot show more than
 * `Profile.publicCard()` chose to: the hidden fields and the exact point never reach it.
 */
export function getPublicProfile(repository: ProfileRepository): GetPublicProfile {
  const read = getProfile(repository)
  return async (id) => (await read(id)).publicCard()
}
