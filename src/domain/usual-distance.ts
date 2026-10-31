import { InvalidProfileFieldError } from './errors.ts'

/**
 * How far a runner usually runs in one run — domain.md §4: the team frontend's three bands, kept
 * as its labels. The middle one has an en dash (U+2013), not a hyphen.
 */
export const USUAL_DISTANCES = ['Under 5 km', '5–10 km', 'Over 10 km'] as const

export type UsualDistance = (typeof USUAL_DISTANCES)[number]

export function isUsualDistance(value: unknown): value is UsualDistance {
  return typeof value === 'string' && (USUAL_DISTANCES as readonly string[]).includes(value)
}

/**
 * Narrows a value arriving from a row or a request body. The message names the three, so a client
 * that typed "5-10 km" with a hyphen can see what it should have sent.
 */
export function toUsualDistance(value: string): UsualDistance {
  if (!isUsualDistance(value)) throw new InvalidProfileFieldError('usualDistance', `must be one of ${USUAL_DISTANCES.join(', ')}`)
  return value
}
