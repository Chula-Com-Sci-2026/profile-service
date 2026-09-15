import { ensure } from './errors.ts'

/** Which running distances a runner prefers — domain.md §4. Declared order, not alphabetical. */
export const DISTANCES = ['5k', '10k', 'half_marathon', 'marathon'] as const

export type Distance = (typeof DISTANCES)[number]

export function isDistance(value: unknown): value is Distance {
  return typeof value === 'string' && (DISTANCES as readonly string[]).includes(value)
}

export class PreferredDistance {
  readonly distance: Distance

  constructor(distance: string) {
    ensure(isDistance(distance), 'preferredDistances', `must be one of ${DISTANCES.join(', ')}`)
    this.distance = distance as Distance
    Object.freeze(this)
  }

  equals(other: PreferredDistance): boolean {
    return this.distance === other.distance
  }

  /** Position in the declared order, so a set sorts 5k before 10k rather than 10k before 5k. */
  get rank(): number {
    return DISTANCES.indexOf(this.distance)
  }
}
