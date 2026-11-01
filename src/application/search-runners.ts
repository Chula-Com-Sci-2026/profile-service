import type { AreaCell } from '../domain/area-cell.ts'
import type { Experience } from '../domain/experience.ts'
import type { Profile } from '../domain/profile.ts'
import type { ProfileRepository } from '../domain/profile-repository.ts'
import type { PublicCard } from '../domain/public-card.ts'
import { getProfile } from './get-profile.ts'

/**
 * TEMPORARY — domain.md §3 `searchRunners()`: Buddy Discovery's search calls this until its own,
 * over the cards it keeps from ProfileUpdated, is live. Then this file, its route and its path in
 * openapi.yaml go; nothing else depends on it.
 */

/** The radius when a search gives none, in kilometres. */
export const DEFAULT_RADIUS_KM = 10

/** What a search asks. `null` (or `false`) is a filter that was not given. */
export type RunnerSearch = {
  /** Kilometres, more than 0. `null` is DEFAULT_RADIUS_KM. */
  radiusKm: number | null
  /** Keeps runners at this level. `null` is every level. */
  experience: Experience | null
  /** Keeps runners whose pace range overlaps the caller's own saved one, ends included. */
  overlappingPace: boolean
  /** Text a runner's availability must contain, ignoring case: already trimmed, never empty. */
  availability: string | null
}

/** A runner the search kept: their public card, and how far its area cell is from the caller's. */
export type SearchResult = { card: PublicCard; distanceKm: number }

export type SearchRunners = (callerId: string, search: RunnerSearch) => Promise<readonly SearchResult[]>

/** The mean radius of the Earth, which haversine treats as a sphere. */
const EARTH_RADIUS_KM = 6371

const radians = (degrees: number): number => (degrees * Math.PI) / 180

/** The great-circle distance between two cells, by haversine. */
function greatCircleKm(from: AreaCell, to: AreaCell): number {
  const halfLatitude = Math.sin(radians(to.latitude - from.latitude) / 2)
  const halfLongitude = Math.sin(radians(to.longitude - from.longitude) / 2)
  const h =
    halfLatitude * halfLatitude +
    Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * halfLongitude * halfLongitude
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * Whether every given filter keeps this card. The filters read the card, never the profile, so a
 * hidden field is `null` and fails a filter on it — hidden means hidden from matching too — and
 * passes when that filter is off. No line here knows which fields are hidden.
 */
function kept(card: PublicCard, caller: Profile, search: RunnerSearch): boolean {
  if (search.experience !== null && card.experience !== search.experience) return false
  if (search.overlappingPace) {
    // Checked for null explicitly: JavaScript reads `null <= x` as `0 <= x`.
    if (card.paceMin === null || card.paceMax === null) return false
    if (!(card.paceMin <= caller.paceMax && caller.paceMin <= card.paceMax)) return false
  }
  if (search.availability !== null) {
    if (card.availability === null) return false
    if (!card.availability.toLowerCase().includes(search.availability.toLowerCase())) return false
  }
  return true
}

/**
 * Every other runner's public card within the radius, nearest first and then by id. Distances are
 * measured between area cells, never exact points (NFR-4.1), so no number of searches places a
 * runner more closely than their cell.
 *
 * `distanceKm`, rounded to one decimal, is the one number both the radius and the order use, so an
 * answer can be checked against itself: everything in it is within the radius it was asked for, in
 * the order its distances read. The caller's pace for the overlap is the range they saved, hidden
 * from their card or not.
 *
 * Every search reads every profile: demo-sized data, and a route meant to be deleted.
 */
export function searchRunners(repository: ProfileRepository): SearchRunners {
  const read = getProfile(repository)
  return async (callerId, search) => {
    const caller = await read(callerId)
    const from = caller.areaCell()
    const radiusKm = search.radiusKm ?? DEFAULT_RADIUS_KM

    const results: SearchResult[] = []
    for (const profile of await repository.findAll()) {
      if (profile.id === caller.id) continue
      const card = profile.publicCard()
      const distanceKm = Math.round(greatCircleKm(from, card.areaCell) * 10) / 10
      if (distanceKm <= radiusKm && kept(card, caller, search)) results.push({ card, distanceKm })
    }
    return results.sort((a, b) => a.distanceKm - b.distanceKm || (a.card.id < b.card.id ? -1 : 1))
  }
}
