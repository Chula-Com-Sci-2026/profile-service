import { ensure } from './errors.ts'

/**
 * How far a runner usually runs in one run — domain.md §4: integer metres, 1–50 000. The ceiling
 * is Run Scheduling's for a run's distance, `(0, 50]` km, in whole metres.
 */
export class UsualDistance {
  readonly metres: number

  constructor(metres: number) {
    ensure(Number.isInteger(metres), 'usualDistance', 'must be a whole number of metres')
    ensure(metres >= 1, 'usualDistance', 'must be at least 1 metre')
    ensure(metres <= 50_000, 'usualDistance', 'must be at most 50000 metres')
    this.metres = metres
    Object.freeze(this)
  }

  equals(other: UsualDistance): boolean {
    return this.metres === other.metres
  }
}
