import { z } from 'zod'
import type { RunnerSearch, SearchResult } from '../../application/search-runners.ts'
import { EXPERIENCES } from '../../domain/experience.ts'
import { cardView, type PhotoUrl } from './profile-view.ts'

/**
 * TEMPORARY — the edge of `GET /api/v1/runners`, Buddy Discovery's search until its own is live.
 * It goes with the search: this file, the route in app.ts and the path in openapi.yaml.
 *
 * It answers one question, "was this filter given?", and leaves what a filter means to the use
 * case. Discovery's request is proto3, where an unset field arrives as `0` or `""`, and the team's
 * contract spells "no filter" as `All` and `Any`; all of those read as not given. Only a value that
 * cannot be read is refused: a `radiusKm` that is not a number, an `experience` outside `All` and
 * the three levels.
 */

/**
 * The query, as Hono hands it over: strings, or absent. `z.object` drops what it does not know, so
 * the gateway's `verifiedOnly` is ignored. `z.coerce.number` reads `radiusKm` as `Number()` does
 * (`""` is 0) and refuses `NaN` and the infinities.
 */
export const runnerSearchQuery = z.object({
  radiusKm: z.coerce.number({ error: 'must be a number of kilometres' }).optional(),
  experience: z.enum(['', 'All', ...EXPERIENCES], { error: `must be one of All, ${EXPERIENCES.join(', ')}` }).optional(),
  pace: z.string().optional(),
  availability: z.string().optional(),
})

export type RunnerSearchQuery = z.infer<typeof runnerSearchQuery>

/** What the query asks, with every not-given form as `null` (or `false`). */
export function toRunnerSearch(query: RunnerSearchQuery): RunnerSearch {
  const { radiusKm, experience, pace, availability } = query
  const text = availability?.trim() ?? ''
  return {
    radiusKm: radiusKm === undefined || radiusKm <= 0 ? null : radiusKm,
    experience: experience === undefined || experience === '' || experience === 'All' ? null : experience,
    // The value itself is not read: any pace other than none at all asks for an overlap.
    overlappingPace: pace !== undefined && pace !== '' && pace !== 'Any',
    availability: text === '' ? null : text,
  }
}

/** One item of the answer: the card exactly as `GET /api/v1/runners/{id}` writes it, plus `distanceKm`. */
export function searchResultView(result: SearchResult, photoUrl: PhotoUrl): Record<string, unknown> {
  return { ...cardView(result.card, photoUrl), distanceKm: result.distanceKm }
}
